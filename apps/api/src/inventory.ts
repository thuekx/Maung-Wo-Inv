import { Asset, AssetStatus } from './orm';
import { AppError, Tx } from './db';

export const AVAILABLE: AssetStatus[] = ['IN_STOCK', 'REFURBISHED'];

export const normSn = (s: string) => s.trim().toUpperCase();

export async function nextNumber(tx: Tx, prefix: string, daily = true) {
  const d = new Date();
  const stamp = daily ? `-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` : '';
  const key = `${prefix}${stamp}`;
  const c = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return `${key}-${String(c.value).padStart(4, '0')}`;
}

interface MoveCtx {
  reason: string;
  woId?: string;
  actorId?: string;
}

/** Pindah / tambah / kurangi stok kuantitas (consumable). from=null → masuk; to=null → terpakai. */
export async function moveStock(
  tx: Tx,
  p: MoveCtx & { itemId: string; qty: number; from?: string | null; to?: string | null },
) {
  if (p.qty <= 0) throw new AppError(400, 'Qty harus > 0');
  if (p.from) {
    const r = await tx.stockLevel.updateMany({
      where: { warehouseId: p.from, itemId: p.itemId, qty: { gte: p.qty } },
      data: { qty: { decrement: p.qty } },
    });
    if (r.count === 0) {
      const [item, wh] = await Promise.all([
        tx.item.findUnique({ where: { id: p.itemId } }),
        tx.warehouse.findUnique({ where: { id: p.from } }),
      ]);
      throw new AppError(409, `Stok ${item?.name ?? p.itemId} di ${wh?.name ?? p.from} tidak cukup (butuh ${p.qty})`);
    }
  }
  if (p.to) {
    await tx.stockLevel.upsert({
      where: { warehouseId_itemId: { warehouseId: p.to, itemId: p.itemId } },
      create: { warehouseId: p.to, itemId: p.itemId, qty: p.qty },
      update: { qty: { increment: p.qty } },
    });
  }
  await tx.stockMovement.create({
    data: {
      itemId: p.itemId,
      qty: p.qty,
      fromWarehouseId: p.from ?? null,
      toWarehouseId: p.to ?? null,
      reason: p.reason,
      woId: p.woId,
      actorId: p.actorId,
    },
  });
}

export async function mustAsset(tx: Tx, sn: string) {
  const asset = await tx.asset.findUnique({ where: { serialNumber: normSn(sn) }, include: { item: true } });
  if (!asset) throw new AppError(404, `SN ${sn} tidak terdaftar di inventori`);
  return asset;
}

export async function moveAsset(
  tx: Tx,
  asset: Asset,
  p: MoveCtx & { status: AssetStatus; toWarehouseId?: string | null; customerId?: string | null; keepWo?: boolean },
) {
  await tx.asset.update({
    where: { id: asset.id },
    data: {
      status: p.status,
      warehouseId: p.toWarehouseId ?? null,
      customerId: p.customerId ?? null,
      woId: p.woId ?? (p.keepWo ? asset.woId : null),
    },
  });
  await tx.stockMovement.create({
    data: {
      itemId: asset.itemId,
      assetId: asset.id,
      qty: 1,
      fromWarehouseId: asset.warehouseId,
      toWarehouseId: p.toWarehouseId ?? null,
      reason: p.reason,
      woId: p.woId,
      actorId: p.actorId,
    },
  });
}

export async function mobileWarehouse(tx: Tx, userId: string) {
  const found = await tx.warehouse.findFirst({ where: { kind: 'MOBILE', ownerId: userId } });
  if (found) return found;
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  return tx.warehouse.create({
    data: { code: `MOB-${u.id.slice(-6).toUpperCase()}`, name: `Mobile Stock – ${u.name}`, kind: 'MOBILE', ownerId: userId },
  });
}

/** Cek kebutuhan standar 1x pemasangan di sebuah gudang. */
export async function installAvailability(tx: Tx, warehouseId: string) {
  const items = await tx.item.findMany({ where: { installDefaultQty: { gt: 0 } } });
  const rows = [];
  for (const item of items) {
    const need = item.installDefaultQty ?? 0;
    const have = item.tracked
      ? await tx.asset.count({ where: { itemId: item.id, warehouseId, status: { in: AVAILABLE } } })
      : ((await tx.stockLevel.findUnique({ where: { warehouseId_itemId: { warehouseId, itemId: item.id } } }))?.qty ?? 0);
    rows.push({ item, need, have });
  }
  return rows;
}

export interface QcResult {
  serial: string;
  result: 'GOOD' | 'DAMAGED' | 'SCRAP';
  warehouseId?: string;
  note?: string;
}

/** Quality Check aset hasil penarikan / penggantian. GOOD → Refurbished (siap pakai). */
export async function qcAssets(tx: Tx, results: QcResult[], actorId: string, woId?: string) {
  for (const r of results) {
    const asset = await mustAsset(tx, r.serial);
    if (asset.status !== 'RETURNED_PENDING_QC') throw new AppError(409, `SN ${asset.serialNumber} tidak berstatus menunggu QC`);
    if (woId && asset.woId !== woId) throw new AppError(409, `SN ${asset.serialNumber} bukan bagian dari WO ini`);
    if (r.result === 'GOOD') {
      if (!r.warehouseId) throw new AppError(400, `Pilih gudang tujuan untuk SN ${asset.serialNumber}`);
      await moveAsset(tx, asset, { status: 'REFURBISHED', toWarehouseId: r.warehouseId, reason: 'QC OK – refurbished', woId, actorId });
    } else {
      await moveAsset(tx, asset, {
        status: r.result === 'SCRAP' ? 'SCRAP' : 'DAMAGED',
        toWarehouseId: r.warehouseId ?? asset.warehouseId,
        reason: `QC ${r.result}${r.note ? ': ' + r.note : ''}`,
        woId,
        actorId,
      });
    }
    if (r.note) await tx.asset.update({ where: { id: asset.id }, data: { condition: r.note } });
  }
}
