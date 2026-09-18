import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationFooterProps {
  currentPage: number;
  totalItems: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  itemLabel?: string;
}

export const PaginationFooter: React.FC<PaginationFooterProps> = ({
  currentPage,
  totalItems,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  itemLabel = 'results',
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
  const endItem = Math.min(currentPage * rowsPerPage, totalItems);

  // Generate page numbers with ellipsis if many pages
  const getPageNumbers = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 3) {
      return [1, 2, 3, 4, '...', totalPages];
    }
    if (currentPage >= totalPages - 2) {
      return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 text-xs text-slate-400 font-sans shrink-0 border-t border-[#261e38]/50">
      {/* Left: Showing X to Y of Z results */}
      <div>
        Showing <span className="font-bold text-slate-200">{startItem}</span> to{' '}
        <span className="font-bold text-slate-200">{endItem}</span> of{' '}
        <span className="font-bold text-slate-200">{totalItems}</span> {itemLabel}
      </div>

      {/* Right: Page Navigation & Rows Per Page Dropdown */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Pagination Buttons */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            {/* Previous Button */}
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1.5 rounded-lg bg-[#161028] border border-purple-500/20 flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition text-xs font-semibold"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            {/* Page Number Buttons */}
            {pageNumbers.map((page, idx) =>
              typeof page === 'number' ? (
                <button
                  key={page}
                  type="button"
                  onClick={() => onPageChange(page)}
                  className={`w-7 h-7 rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center ${
                    currentPage === page
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                      : 'bg-[#161028] border border-purple-500/20 text-slate-300 hover:bg-[#1f1833] hover:text-white'
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={`ellipsis-${idx}`} className="px-1 text-slate-500 font-bold">
                  ...
                </span>
              )
            )}

            {/* Next Button */}
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="px-2.5 py-1.5 rounded-lg bg-[#161028] border border-purple-500/20 flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition text-xs font-semibold"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Rows per page dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Rows per page:</span>
          <select
            value={rowsPerPage}
            onChange={(e) => {
              const newRows = Number(e.target.value);
              onRowsPerPageChange(newRows);
              onPageChange(1);
            }}
            className="bg-[#161028] border border-purple-500/30 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-purple-400 cursor-pointer font-semibold shadow-sm"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>
    </div>
  );
};
