import { useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Btn, Card, Input, Select, useAction, useLoad, useToast } from '../ui';

type Assignment = { id: string; staff_id: string; role: string | null; display_name: string };
type Data = { assignments: Assignment[]; staff: Array<{ id: string; display_name: string; job_title: string | null }> };

/** Who is working on an order or project. Assignments also drive the team filter on the calendar. */
export function AssignedTeam({ subjectType, subjectId, canManage }: { subjectType: 'order' | 'project'; subjectId: string; canManage: boolean }) {
  const state = useLoad<Data>(`/api/admin/assignments?subject_type=${subjectType}&subject_id=${subjectId}`);
  const { busy, run } = useAction();
  const toast = useToast();
  const [staffId, setStaffId] = useState('');
  const [role, setRole] = useState('');
  const assigned = state.data?.assignments ?? [];
  const available = (state.data?.staff ?? []).filter((s) => !assigned.some((a) => a.staff_id === s.id));

  const add = async () => {
    const res = await run(() => api<{ warning: string | null }>('/api/admin/assignments', { body: { subject_type: subjectType, subject_id: subjectId, staff_id: staffId, role: role.trim() || null } }), 'Assigned.');
    if (res) {
      if (res.warning) toast('error', res.warning);
      setStaffId('');
      setRole('');
      void state.reload();
    }
  };

  return (
    <Card title="Assigned team">
      {assigned.length === 0 && <p className="text-[0.85rem] text-charcoal/70">Nobody yet.</p>}
      <ul className="space-y-1.5 text-[0.88rem]">
        {assigned.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{a.display_name} {a.role && <Badge>{a.role}</Badge>}</span>
            {canManage && <Btn small tone="ghost" disabled={busy} aria-label={`Remove ${a.display_name}`} onClick={async () => { await run(() => api(`/api/admin/assignments/${a.id}`, { method: 'DELETE' })); void state.reload(); }}>Remove</Btn>}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="sr-only">Team member to assign</span>
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Choose someone</option>
              {available.map((s) => <option key={s.id} value={s.id}>{s.display_name}{s.job_title ? `, ${s.job_title}` : ''}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="sr-only">Their role on this work</span>
            <Input placeholder="Role, such as lead florist (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <Btn small disabled={busy || !staffId} onClick={add}>Assign</Btn>
        </div>
      )}
    </Card>
  );
}
