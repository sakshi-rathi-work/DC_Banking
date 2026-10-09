import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { MoneyDisplay } from '../../components/common/money-display';
import { StatusBadge } from '../../components/common/status-badge';
import { NodeBadge } from '../../components/common/node-badge';
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight, Filter } from 'lucide-react';

export const TransactionsPage: React.FC = () => {
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Fetch accounts for filter dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await api.listAccounts();
      return res.data?.accounts || [];
    },
  });

  // Fetch filtered transactions
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions', 'filtered', selectedAccountId, selectedType],
    queryFn: async () => {
      const res = await api.listTransactions({
        accountId: selectedAccountId || undefined,
        type: selectedType || undefined,
        limit: 50,
      });
      return res.data?.transactions || [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Transaction History</h2>
          <p className="text-sm text-slate-400 mt-1">Audit log of all replicated banking operations</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel p-4 rounded-xl flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-400">
          <Filter className="w-4 h-4" />
          <span className="font-semibold text-xs uppercase">Filters:</span>
        </div>

        {/* Account Filter */}
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
        >
          <option value="">All Accounts</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.nickname || acc.accountNumber}
            </option>
          ))}
        </select>

        {/* Type Filter */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
        >
          <option value="">All Types</option>
          <option value="DEPOSIT">Deposits</option>
          <option value="WITHDRAWAL">Withdrawals</option>
          <option value="TRANSFER">Transfers</option>
        </select>

        {(selectedAccountId || selectedType) && (
          <button
            onClick={() => {
              setSelectedAccountId('');
              setSelectedType('');
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Transactions Table */}
      <div className="glass-panel p-6 rounded-2xl">
        {isLoading ? (
          <div className="py-16 text-center text-slate-500 animate-pulse">Loading transaction logs...</div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            No transactions matching filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Node Routing</th>
                  <th className="pb-3">Lamport & Epoch</th>
                  <th className="pb-3">Reference / Note</th>
                  <th className="pb-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30">
                    <td className="py-3 font-medium text-white flex items-center gap-2">
                      {tx.type === 'DEPOSIT' && <ArrowDownRight className="w-4 h-4 text-emerald-400" />}
                      {tx.type === 'WITHDRAWAL' && <ArrowUpRight className="w-4 h-4 text-rose-400" />}
                      {tx.type === 'TRANSFER' && <ArrowLeftRight className="w-4 h-4 text-sky-400" />}
                      <span>{tx.type}</span>
                    </td>
                    <td className="py-3">
                      <MoneyDisplay
                        paise={tx.amountPaise}
                        sign={tx.type !== 'WITHDRAWAL'}
                        className={tx.type === 'WITHDRAWAL' ? 'text-rose-400' : 'text-emerald-400'}
                      />
                    </td>
                    <td className="py-3">
                      <StatusBadge status={tx.status} type="transaction" />
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <NodeBadge nodeId={tx.processedByNode || tx.entryNode} />
                        {tx.entryNode !== tx.processedByNode && (
                          <span className="text-xs text-slate-500 font-mono">
                            via N{tx.entryNode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-xs font-mono text-slate-400">
                      <div>L={tx.lamport}</div>
                      <div className="text-slate-500">Epoch {tx.epoch}</div>
                    </td>
                    <td className="py-3 text-xs">
                      <div className="font-mono text-slate-300">{tx.reference}</div>
                      {tx.note && <div className="text-slate-500 truncate max-w-xs">{tx.note}</div>}
                    </td>
                    <td className="py-3 text-xs text-slate-400">
                      {new Date(tx.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
