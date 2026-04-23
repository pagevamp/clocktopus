export interface LocalProject {
  id: string;
  name: string;
  ticketPrefixes?: string[];
}

export function matchProjectByTicket(ticket: string | null, projects: LocalProject[]): LocalProject | null {
  if (!ticket) return null;
  const prefix = ticket.split('-')[0]?.toUpperCase();
  if (!prefix) return null;
  for (const p of projects) {
    if (!p.ticketPrefixes) continue;
    if (p.ticketPrefixes.some((tp) => tp.toUpperCase() === prefix)) return p;
  }
  return null;
}
