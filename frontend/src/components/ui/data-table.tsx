'use client'

import * as React from 'react'
import {
    ColumnDef,
    ColumnResizeMode,
    SortingState,
    RowSelectionState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    // 排序
    sorting?: SortingState
    onSortingChange?: (sorting: SortingState) => void
    // 行选择
    rowSelection?: RowSelectionState
    onRowSelectionChange?: (selection: RowSelectionState) => void
    getRowId?: (row: TData) => string
    // 列宽调整
    enableColumnResizing?: boolean
    columnResizeMode?: ColumnResizeMode
    // 样式
    compact?: boolean
    className?: string
}

export function DataTable<TData, TValue>({
    columns,
    data,
    sorting: externalSorting,
    onSortingChange,
    rowSelection: externalRowSelection,
    onRowSelectionChange,
    getRowId,
    enableColumnResizing = true,
    columnResizeMode = 'onChange',
    compact = true,
    className,
}: DataTableProps<TData, TValue>) {
    // 内部状态（如果没有外部控制）
    const [internalSorting, setInternalSorting] = React.useState<SortingState>([])
    const [internalRowSelection, setInternalRowSelection] = React.useState<RowSelectionState>({})

    const sorting = externalSorting ?? internalSorting
    const rowSelection = externalRowSelection ?? internalRowSelection

    const handleSortingChange = React.useCallback(
        (updater: SortingState | ((old: SortingState) => SortingState)) => {
            const newSorting = typeof updater === 'function' ? updater(sorting) : updater
            if (onSortingChange) {
                onSortingChange(newSorting)
            } else {
                setInternalSorting(newSorting)
            }
        },
        [sorting, onSortingChange]
    )

    const handleRowSelectionChange = React.useCallback(
        (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
            const newSelection = typeof updater === 'function' ? updater(rowSelection) : updater
            if (onRowSelectionChange) {
                onRowSelectionChange(newSelection)
            } else {
                setInternalRowSelection(newSelection)
            }
        },
        [rowSelection, onRowSelectionChange]
    )

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            rowSelection,
        },
        onSortingChange: handleSortingChange,
        onRowSelectionChange: handleRowSelectionChange,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId,
        enableColumnResizing,
        columnResizeMode,
        enableRowSelection: true,
    })

    return (
        <div className={cn(
            'overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800',
            className
        )}>
            <table className="w-full min-w-full table-fixed">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id} className="border-b border-gray-200 dark:border-gray-700">
                            {headerGroup.headers.map((header) => {
                                const canSort = header.column.getCanSort()
                                const sortDirection = header.column.getIsSorted()

                                return (
                                    <th
                                        key={header.id}
                                        className={cn(
                                            'relative text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap',
                                            'border-r border-gray-100 dark:border-gray-700 last:border-r-0',
                                            compact ? 'px-3 py-2.5 text-xs' : 'px-4 py-3 text-sm',
                                            canSort && 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
                                        )}
                                        style={{ width: header.getSize() }}
                                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(header.column.columnDef.header, header.getContext())}
                                            {canSort && (
                                                <span className="flex-shrink-0">
                                                    {sortDirection === 'asc' ? (
                                                        <ArrowUp className="h-3.5 w-3.5 text-primary-600" />
                                                    ) : sortDirection === 'desc' ? (
                                                        <ArrowDown className="h-3.5 w-3.5 text-primary-600" />
                                                    ) : (
                                                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                        {/* 列宽调整手柄 */}
                                        {enableColumnResizing && header.column.getCanResize() && (
                                            <div
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                className={cn(
                                                    'absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none',
                                                    'hover:bg-primary-400 dark:hover:bg-primary-500',
                                                    header.column.getIsResizing() && 'bg-primary-500 dark:bg-primary-400'
                                                )}
                                            />
                                        )}
                                    </th>
                                )
                            })}
                        </tr>
                    ))}
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {table.getRowModel().rows.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columns.length}
                                className="text-center py-12 text-gray-400 dark:text-gray-500"
                            >
                                暂无数据
                            </td>
                        </tr>
                    ) : (
                        table.getRowModel().rows.map((row) => (
                            <tr
                                key={row.id}
                                className={cn(
                                    'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                                    row.getIsSelected() && 'bg-primary-50 dark:bg-primary-900/20'
                                )}
                            >
                                {row.getVisibleCells().map((cell) => {
                                    const isInteractiveCol = ['tags', 'actions', 'select', 'note', 'routingConfig'].includes(cell.column.id)
                                    return (
                                    <td
                                        key={cell.id}
                                        className={cn(
                                            'text-gray-700 dark:text-gray-200',
                                            'border-r border-gray-50 dark:border-gray-800 last:border-r-0',
                                            compact ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-sm'
                                        )}
                                        style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
                                    >
                                        {isInteractiveCol ? (
                                            flexRender(cell.column.columnDef.cell, cell.getContext())
                                        ) : (
                                            <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </div>
                                        )}
                                    </td>
                                    )
                                })}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    )
}

// 辅助函数：创建选择列
export function createSelectColumn<TData>(): ColumnDef<TData, unknown> {
    return {
        id: 'select',
        size: 44,
        enableSorting: false,
        enableResizing: false,
        header: ({ table }) => (
            <div className="flex items-center justify-center">
                <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    checked={table.getIsAllRowsSelected()}
                    ref={(el) => {
                        if (el) {
                            el.indeterminate = table.getIsSomeRowsSelected()
                        }
                    }}
                    onChange={table.getToggleAllRowsSelectedHandler()}
                />
            </div>
        ),
        cell: ({ row }) => (
            <div className="flex items-center justify-center">
                <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    checked={row.getIsSelected()}
                    onChange={row.getToggleSelectedHandler()}
                />
            </div>
        ),
    }
}
