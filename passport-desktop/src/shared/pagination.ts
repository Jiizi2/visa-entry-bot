export function paginationState(totalItems, { currentPage = 1, pageSize = 1 } = {}) {
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  const safeTotalItems = Math.max(0, Number(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotalItems / safePageSize));
  const normalizedPage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages);
  const offset = (normalizedPage - 1) * safePageSize;
  const startIndex = safeTotalItems ? offset + 1 : 0;
  const endIndex = Math.min(offset + safePageSize, safeTotalItems);
  return {
    totalItems: safeTotalItems,
    pageSize: safePageSize,
    totalPages,
    currentPage: normalizedPage,
    offset,
    startIndex,
    endIndex,
    canMovePrev: normalizedPage > 1,
    canMoveNext: normalizedPage < totalPages,
  };
}

export function paginateItems(items, pagination) {
  return items.slice(pagination.offset, pagination.offset + pagination.pageSize);
}

export function reviewPaginationSummaryText({ totalItems, activeIndex, reviewed, total }) {
  const safeIndex = activeIndex >= 0 ? activeIndex + 1 : 0;
  if (!totalItems) {
    return "0 dari 0 passport";
  }
  return `Passport ${safeIndex} dari ${totalItems} | ${reviewed}/${total} direview`;
}

export function passportListSummaryText(pagination, totalMembers) {
  const pageText = pagination.totalPages > 1
    ? ` | Halaman ${pagination.currentPage}/${pagination.totalPages}`
    : "";
  if (!pagination.totalItems) {
    return totalMembers ? `0 dari ${totalMembers} data${pageText}` : "0 dari 0 data";
  }
  const rangeText = `${pagination.startIndex}-${pagination.endIndex}`;
  if (pagination.totalItems === totalMembers) {
    return `${rangeText} dari ${totalMembers} data${pageText}`;
  }
  return `${rangeText} dari ${pagination.totalItems} data terfilter (${totalMembers} total)${pageText}`;
}
