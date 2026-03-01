export const parseAppDate = (value?: string | Date | null) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  if (/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(raw)) {
    const utcDate = new Date(raw);
    if (Number.isNaN(utcDate.getTime())) return null;
    return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const toDateInputValue = (value?: string | Date | null) => {
  const parsed = parseAppDate(value);
  if (!parsed) return '';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const formatZhDateTimeShort = (value?: string | Date | null) => {
  const parsed = parseAppDate(value);
  if (!parsed) return '-';
  return parsed.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatZhDateTime = (value?: string | Date | null) => {
  const parsed = parseAppDate(value);
  if (!parsed) return '-';
  return parsed.toLocaleString('zh-CN');
};
