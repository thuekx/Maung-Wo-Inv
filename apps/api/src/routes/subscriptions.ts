import { Router } from 'express';
import { z } from 'zod';
import { AppError, fieldError, prisma } from '../db';
import { authenticate, requireRole } from '../auth';
import { auditedDelete, auditedUpdate, changes, whoOf, writeAudit } from '../audit';
import { transact } from '../effects';
import { countIf, pageParams, sendPage } from '../paging';
import { getSubForm, putSetting, regYear3, SUBFORM_DEFAULTS } from '../settings';

/** Formulir Berlangganan digital: diterbitkan Marketing, tersimpan, dapat dicetak (PDF) untuk ditandatangani pelanggan. */
export const subscriptionRoutes = Router();
subscriptionRoutes.use(authenticate);

const nul = (v: unknown) => (v === '' ? null : v);
const opt = (max: number) => z.preprocess(nul, z.string().trim().max(max, `Maksimal ${max} karakter`).nullable().optional());
const fee = z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().min(0, 'Tidak boleh negatif').max(1e10).nullable().optional());

/* ── pengaturan (Admin) ── */
subscriptionRoutes.get('/subscription-settings', async (_req, res) => res.json({ ...(await getSubForm()), year3: regYear3(new Date()) }));
subscriptionRoutes.put('/admin/settings/subform', requireRole('ADMIN'), async (req, res) => {
  const t = (max: number) => z.string().trim().min(1).max(max);
  const b = z.object({
    regPrefix: z.string().trim().min(1).max(6).regex(/^[A-Za-z]+$/, 'Hanya huruf'),
    regSeqStart: z.coerce.number().int('Harus bilangan bulat').min(1, 'Minimal 1').max(999999),
    city: t(40), managerName: t(80), bankName: t(80), accName: t(80),
    accNo: z.string().trim().min(3).max(30).regex(/^[0-9 -]+$/, 'Hanya angka'),
    footer: z.string().trim().min(1).max(300), defaultPayment: z.enum(['CASH', 'TRANSFER', 'DEBIT']), ppnNote: t(60),
  }).parse(req.body);
  await putSetting('subform', { ...SUBFORM_DEFAULTS, ...b }, req.user!.id);
  res.json(await getSubForm());
});

/* ── CRUD ── */
const body = z.object({
  formDate: z.coerce.date().optional(),
  name: opt(120), address: opt(300),
  phone: z.preprocess(nul, z.string().trim().max(20).regex(/^[0-9+][0-9 +()-]*$/, 'Hanya angka, spasi, + ( ) -').nullable().optional()),
  email: z.preprocess(nul, z.string().email('Format email tidak valid').max(120).nullable().optional()),
  referral: opt(120), packageName: opt(80), serviceNote: opt(200),
  installFee: fee, monthlyFee: fee,
  picName: opt(120),
  picPhone: z.preprocess(nul, z.string().trim().max(20).regex(/^[0-9+][0-9 +()-]*$/, 'Hanya angka, spasi, + ( ) -').nullable().optional()),
  payment: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.enum(['CASH', 'TRANSFER', 'DEBIT']).optional()),
  marketingName: opt(80), managerName: opt(80),
});

const canWrite = requireRole('MKT');
const readers = requireRole('MKT'); // Formulir Berlangganan hanya Marketing (dan Admin)

const regNoOf = async (date: Date, suffix: string) => `${(await getSubForm()).regPrefix}${regYear3(date)}${suffix}`;

subscriptionRoutes.get('/subscriptions', readers, async (req, res) => {
  const q = z.object({ q: z.string().optional() }).parse(req.query);
  const pp = pageParams(req, { sorts: { regNo: (d) => ({ regNo: d }), name: (d) => ({ name: d }), formDate: (d) => ({ formDate: d }), createdAt: (d) => ({ createdAt: d }) }, defaultSort: { key: 'createdAt', dir: 'desc' }, legacyLimit: 100 });
  const term = q.q?.trim();
  const where = term ? { OR: [{ regNo: { contains: term, mode: 'insensitive' as const } }, { name: { contains: term, mode: 'insensitive' as const } }, { phone: { contains: term } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({ where, include: { createdBy: { select: { name: true } } }, orderBy: pp.orderBy, skip: pp.skip, take: pp.take }),
    countIf(pp, () => prisma.subscription.count({ where })),
  ]);
  sendPage(res, pp, rows, total);
});

subscriptionRoutes.get('/subscriptions/:id', readers, async (req, res) => {
  const s = await prisma.subscription.findUnique({ where: { id: String(req.params.id) }, include: { createdBy: { select: { id: true, name: true } } } });
  if (!s) throw new AppError(404, 'Formulir tidak ditemukan');
  const wo = s.woId ? await prisma.workOrder.findUnique({ where: { id: s.woId }, select: { id: true, number: true, status: true } }) : null;
  res.json({ ...s, wo, settings: await getSubForm() });
});

subscriptionRoutes.post('/subscriptions', canWrite, async (req, res) => {
  const b = body.parse(req.body);
  const cfg = await getSubForm();
  const date = b.formDate ?? new Date();
  const who = whoOf(req);
  const { formDate: _fd, ...rest } = b;
  const row = await transact(async (fx) => {
    // nomor registrasi otomatis: awalan + 3 digit tahun + urutan (urutan pertama diatur Admin), per tahun
    const key = `SUBREG-${date.getFullYear()}`;
    let regNo = '';
    for (let n = 0; n < 50; n++) {
      let c = await fx.tx.counter.upsert({ where: { key }, create: { key, value: cfg.regSeqStart }, update: { value: { increment: 1 } } });
      if (c.value < cfg.regSeqStart) c = await fx.tx.counter.update({ where: { key }, data: { value: cfg.regSeqStart } }); // Admin menaikkan nomor mulai
      regNo = await regNoOf(date, String(c.value).padStart(4, '0'));
      if (!(await fx.tx.subscription.findUnique({ where: { regNo } }))) break;
    }
    const r = await fx.tx.subscription.create({ data: { ...rest, regNo, formDate: date, payment: b.payment ?? cfg.defaultPayment, managerName: b.managerName === undefined ? cfg.managerName : b.managerName, marketingName: b.marketingName === undefined ? req.user!.name : b.marketingName, createdById: req.user!.id } as any });
    await writeAudit(fx, who, { action: 'CREATE', entity: 'formulir berlangganan', entityId: r.id, summary: `${who.name} menerbitkan formulir berlangganan ${regNo}${r.name ? ` (${r.name})` : ''}` });
    return r;
  });
  res.status(201).json({ id: row.id, regNo: row.regNo });
});

subscriptionRoutes.patch('/subscriptions/:id', canWrite, async (req, res) => {
  const id = String(req.params.id);
  const b = body.partial().parse(req.body);
  const cur = await prisma.subscription.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'Formulir tidak ditemukan');
  const { formDate, ...rest } = b;
  const data: Record<string, unknown> = { ...rest }; // nomor registrasi tetap (otomatis saat dibuat)
  if (formDate) data.formDate = formDate;
  res.json(await auditedUpdate(whoOf(req), 'formulir berlangganan', id, cur.regNo, changes(cur, data), (fx) => fx.tx.subscription.update({ where: { id }, data: data as any })));
});

subscriptionRoutes.delete('/subscriptions/:id', canWrite, async (req, res) => {
  const id = String(req.params.id);
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s) throw new AppError(404, 'Formulir tidak ditemukan');
  if (s.woId) throw new AppError(409, 'Formulir sudah menjadi WO Pasang Baru — tidak dapat dihapus');
  await auditedDelete(whoOf(req), 'formulir berlangganan', id, s.regNo, { id, regNo: s.regNo, name: s.name }, (fx) => fx.tx.subscription.delete({ where: { id } }));
  res.json({ ok: true });
});
