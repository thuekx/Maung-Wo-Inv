import { Prisma, Role, SubRole, WoType, CustomerStatus } from './orm';
import { Tx } from './db';
import { Effects } from './effects';

export type FieldType =
  | 'text' | 'number' | 'textarea' | 'datetime' | 'select' | 'bool'
  | 'technician' | 'warehouse' | 'customer' | 'package' | 'serials' | 'materials' | 'photos' | 'qc';

/** Metadata form — dikirim ke frontend agar form dirender dinamis. Validasi sebenarnya ada di handler (zod). */
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  itemCategory?: 'CONSUMABLE' | 'NETWORK' | 'GA';
  customerStatus?: CustomerStatus[];
  /** materials: hanya item yang diambil teknisi di WO ini (laporan instalasi) */
  pickedOnly?: boolean;
}

export type WoFull = Prisma.WorkOrderGetPayload<{ include: { customer: true } }>;
export interface Actor { id: string; name: string; role: Role; subRole?: SubRole | null; /** Admin yang bertindak sebagai peran lain */ acting?: boolean }

/** Supervisor/manager (atau Admin asli). */
export const isLead = (a: Actor) => a.role === 'ADMIN' || a.subRole === 'SUPERVISOR' || a.subRole === 'MANAGER';

export interface Ctx {
  tx: Tx;
  fx: Effects;
  wo: WoFull;
  actor: Actor;
  /** digabung ke wo.data saat transisi */
  data: Record<string, any>;
  /** kolom WO yang ikut diupdate saat transisi */
  patch: { assigneeId?: string | null; scheduledAt?: Date | null };
  createChild(type: WoType, input: Record<string, any>): Promise<{ id: string; number: string }>;
}

export interface ActionDef {
  key: string;
  label: string;
  roles: Role[];
  to: string;
  fields: Field[];
  assigneeOnly?: boolean; // hanya teknisi yang ditugaskan (atau ADMIN)
  leadOnly?: boolean; // hanya supervisor/manager (atau ADMIN) di divisi yang berhak
  system?: boolean; // hanya dipicu sistem, tidak tampil di UI
  danger?: boolean;
  /** boleh mengembalikan status tujuan lain untuk menimpa `to` */
  run?: (ctx: Ctx, input: any) => Promise<string | void>;
}

export interface StatusDef {
  label: string;
  owner: Role; // divisi yang harus bertindak
  final?: boolean;
  noCancel?: boolean;
  actions: ActionDef[];
  onEnter?: (ctx: Ctx) => Promise<{ to: string; note?: string } | void>;
}

export interface Workflow {
  type: WoType;
  prefix: string;
  label: string;
  description: string;
  createRoles: Role[];
  createFields: Field[];
  initial: string;
  uniqueOpenPerCustomer?: boolean;
  create(tx: Tx, input: any, actor: Actor): Promise<{ title: string; customerId?: string; data?: Record<string, any>; note?: string }>;
  onCancel?(ctx: Ctx): Promise<void>;
  statuses: Record<string, StatusDef>;
}
