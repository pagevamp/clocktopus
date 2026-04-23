const TICKET_REGEX = /([A-Za-z][A-Za-z0-9]+-\d+)/;

export function extractTicket(branch: string): string | null {
  if (!branch) return null;
  const match = branch.match(TICKET_REGEX);
  return match ? match[1].toUpperCase() : null;
}
