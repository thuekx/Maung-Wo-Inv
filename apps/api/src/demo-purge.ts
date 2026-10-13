import fs from 'fs';
import path from 'path';
import { prisma } from './db';
import { config } from './config';

/**
 * Uji sambung CRM→WO: penawaran demo yang sengaja dikirim CRM (demo:true) membuat order/pelanggan/PR bertanda
 * (WorkOrder.source = CRM_DEMO, Customer.source = CRM_DEMO, CrmQuotation.isDemo, PurchaseRequest.isDemo).
 * Di sini jumlahnya dihitung dan dapat dihapus TERARAH (hanya yang bertanda) — data sungguhan tidak tersentuh.
 */
export async function crmDemoCounts() {
  const [quotations, orders, customers, prs] = await Promise.all([
    prisma.crmQuotation.count({ where: { isDemo: true } }),
    prisma.workOrder.count({ where: { source: 'CRM_DEMO' } }),
    prisma.customer.count({ where: { source: 'CRM_DEMO' } }),
    prisma.purchaseRequest.count({ where: { isDemo: true } }),
  ]);
  return { quotations, orders, customers, purchaseRequests: prs };
}

export async function purgeCrmDemo() {
  const files: string[] = [];
  const out = await prisma.$transaction(async (tx) => {
    const qs = await tx.crmQuotation.findMany({ where: { isDemo: true }, select: { id: true, woId: true } });
    const roots = new Set<string>(qs.map((q) => q.woId).filter((x): x is string => !!x));
    for (const w of await tx.workOrder.findMany({ where: { source: 'CRM_DEMO' }, select: { id: true } })) roots.add(w.id);
    const children = (await tx.workOrder.findMany({ where: { parentId: { in: [...roots] } }, select: { id: true } })).map((w) => w.id);
    const woIds = [...new Set([...roots, ...children])];

    // pengaman: jangan menghapus bila order uji sambung sudah menyentuh PO atau aset ber-SN (tidak dapat dibersihkan otomatis)
    const prs = await tx.purchaseRequest.findMany({ where: { OR: [{ isDemo: true }, { woId: { in: woIds } }] }, select: { id: true, lines: { select: { id: true, poLineId: true } } } });
    if (prs.some((p) => p.lines.some((l) => l.poLineId))) throw new Error('PR uji sambung sudah menjadi PO — hapus/selesaikan PO-nya dulu');
    if (await tx.purchaseOrder.count({ where: { woId: { in: woIds } } })) throw new Error('Ada PO yang terhubung ke order uji sambung — hapus PO-nya dulu');
    const demoCust = (await tx.customer.findMany({ where: { source: 'CRM_DEMO' }, select: { id: true } })).map((c) => c.id);
    const assets = await tx.asset.count({ where: { OR: [{ woId: { in: woIds } }, { customerId: { in: demoCust } }] } });
    if (assets) throw new Error(`Ada ${assets} aset ber-SN yang terhubung ke order/pelanggan uji sambung — kembalikan ke stok (QC) dulu`);

    // balikkan mutasi stok habis-pakai yang dibuat order uji sambung (ambil/pakai material) agar stok sungguhan kembali seperti semula
    const moves = await tx.stockMovement.findMany({ where: { woId: { in: woIds }, assetId: null }, orderBy: { createdAt: 'desc' } });
    const bump = async (warehouseId: string, itemId: string, delta: number) => {
      const lvl = await tx.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId, itemId } } });
      const next = (lvl?.qty ?? 0) + delta;
      if (next < 0) throw new Error('Stok tidak dapat dibalikkan (jumlah akan negatif) — sesuaikan stok manual lalu ulangi');
      if (lvl) await tx.stockLevel.update({ where: { id: lvl.id }, data: { qty: next } });
      else await tx.stockLevel.create({ data: { warehouseId, itemId, qty: next } });
    };
    for (const m of moves) {
      if (m.fromWarehouseId) await bump(m.fromWarehouseId, m.itemId, m.qty);
      if (m.toWarehouseId) await bump(m.toWarehouseId, m.itemId, -m.qty);
    }

    const prIds = prs.map((p) => p.id);
    await tx.prQuote.deleteMany({ where: { line: { prId: { in: prIds } } } });
    await tx.prLine.deleteMany({ where: { prId: { in: prIds } } });
    await tx.purchaseRequest.deleteMany({ where: { id: { in: prIds } } });
    await tx.stockMovement.deleteMany({ where: { woId: { in: woIds } } });
    await tx.notification.deleteMany({ where: { woId: { in: woIds } } });
    await tx.inbox.deleteMany({ where: { woId: { in: woIds } } });
    for (const a of await tx.attachment.findMany({ where: { woId: { in: woIds } }, select: { url: true } })) files.push(a.url);
    await tx.attachment.deleteMany({ where: { woId: { in: woIds } } });
    await tx.woEvent.deleteMany({ where: { woId: { in: woIds } } });
    await tx.subscription.updateMany({ where: { woId: { in: woIds } }, data: { woId: null } });
    await tx.workOrder.deleteMany({ where: { id: { in: children } } });
    await tx.workOrder.deleteMany({ where: { id: { in: [...roots] } } });
    // pelanggan hasil uji sambung dihapus bila tidak ada WO lain yang memakainya
    let customers = 0;
    for (const id of demoCust) {
      if (await tx.workOrder.count({ where: { customerId: id } })) continue;
      await tx.customerChange.deleteMany({ where: { customerId: id } });
      await tx.subscription.updateMany({ where: { customerId: id }, data: { customerId: null } });
      await tx.customer.delete({ where: { id } });
      customers++;
    }
    await tx.crmQuotation.deleteMany({ where: { isDemo: true } });
    return { quotations: qs.length, orders: woIds.length, customers, purchaseRequests: prIds.length, stockMovementsReversed: moves.length };
  }, { timeout: 60_000 });
  let removedFiles = 0;
  for (const u of files) { try { fs.unlinkSync(path.join(config.uploadDir, path.basename(u))); removedFiles++; } catch { /* sudah tidak ada */ } }
  return { ...out, removedFiles };
}

/** Ringkasan integritas sisi WO untuk rekonsiliasi: penawaran per status, WON tanpa order, order CRM tanpa penawaran. */
export async function crmReconSummary() {
  const [grp, wonNoOrder, linked] = await Promise.all([
    prisma.crmQuotation.groupBy({ by: ['status', 'isDemo'], _count: true }),
    prisma.crmQuotation.count({ where: { status: 'WON', woId: null } }),
    prisma.crmQuotation.findMany({ where: { woId: { not: null } }, select: { woId: true } }),
  ]);
  const orphan = await prisma.workOrder.count({ where: { type: 'SERVICE_ORDER', id: { notIn: linked.map((l) => l.woId as string) } } });
  const byStatus: Record<string, { real: number; demo: number }> = {};
  for (const g of grp) { const e = (byStatus[g.status] ??= { real: 0, demo: 0 }); if (g.isDemo) e.demo += g._count; else e.real += g._count; }
  return { byStatus, wonWithoutOrder: wonNoOrder, ordersWithoutQuotation: orphan };
}
