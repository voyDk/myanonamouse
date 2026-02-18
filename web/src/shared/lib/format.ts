export const formatPoints = (value: number): string => `${value.toLocaleString()} pts`;

export const formatWeeks = (value: number): string => `${value.toFixed(1)} weeks`;

export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
