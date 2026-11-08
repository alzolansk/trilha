import { daysBetween } from './time';
/** O cron pode ter rodado antes do clique: aportes de ontem ainda têm uma janela de envio. */
export function taskDueForPush(task: { due_date: string | null; assignee_id: string | null; dismissed: boolean; alert_key?: string | null }, userId: string, today: string): boolean {
  if (task.dismissed || !task.due_date || task.assignee_id && task.assignee_id !== userId) return false;
  const days = daysBetween(today, task.due_date);
  return days <= 1 && days >= (task.alert_key?.startsWith('pool:') ? -1 : 0);
}
