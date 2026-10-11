import { Tx } from './db';
import { getSubForm, regYear3 } from './settings';

/** Nomor registrasi Formulir Berlangganan otomatis: awalan + 3 digit tahun + urutan (urutan pertama diatur Admin), per tahun. */
export async function issueRegNo(tx: Tx, date: Date): Promise<string> {
  const cfg = await getSubForm();
  const key = `SUBREG-${date.getFullYear()}`;
  let regNo = '';
  for (let n = 0; n < 50; n++) {
    let c = await tx.counter.upsert({ where: { key }, create: { key, value: cfg.regSeqStart }, update: { value: { increment: 1 } } });
    if (c.value < cfg.regSeqStart) c = await tx.counter.update({ where: { key }, data: { value: cfg.regSeqStart } }); // Admin menaikkan nomor mulai
    regNo = `${cfg.regPrefix}${regYear3(date)}${String(c.value).padStart(4, '0')}`;
    if (!(await tx.subscription.findUnique({ where: { regNo } }))) break;
  }
  return regNo;
}
