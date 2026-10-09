import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { MoneyDisplay } from '../../components/common/money-display';
import { MoneyInput } from '../../components/common/money-input';
import { StatusBadge } from '../../components/common/status-badge';
import { NodeBadge } from '../../components/common/node-badge';
import { CreditCard, ArrowDownRight, ArrowUpRight, ArrowLeftRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [modalType, setModalType] = useState<'deposit' | 'withdraw' | 'transfer' | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [destAccountLookup, setDestAccountLookup] = useState<string>('');
  const [destAccount, setDestAccount] = useState<{ id: string; holderMasked: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [amountPaise, setAmountPaise] = useState<number>(10000);
  const [note, setNote] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch accounts
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await api.listAccounts();
      return res.data?.accounts || [];
    },
  });

  // Fetch recent transactions
  const { data: txnsData } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: async () => {
      const res = await api.listTransactions({ limit: 8 });
      return res.data?.transactions || [];
    },
  });

  const accounts = accountsData || [];
  const transactions = txnsData || [];

  const totalPaise = accounts.reduce((sum, acc) => sum + acc.balancePaise, 0);

  // Lookup destination account
  const handleLookup = async () => {
    if (!destAccountLookup.trim()) return;
    setLookupLoading(true);
    setActionError(null);
    try {
      const res = await api.lookupAccount(destAccountLookup.trim());
      if (res.data?.account) {
        setDestAccount({
          id: res.data.account.id,
          holderMasked: res.data.account.holderMasked,
        });
      }
    } catch (err: any) {
      setActionError(err.message || 'Account not found');
      setDestAccount(null);
    } finally {
      setLookupLoading(false);
    }
  };

  // Transaction mutation
  const txnMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAccountId && accounts[0]) {
        setSelectedAccountId(accounts[0].id);
      }
      const accId = selectedAccountId || accounts[0]?.id;
      if (!accId) throw new Error('Please select an account');

      if (modalType === 'deposit') {
        return api.deposit(accId, amountPaise, note);
      } else if (modalType === 'withdraw') {
        return api.withdraw(accId, amountPaise, note);
      } else if (modalType === 'transfer') {
        if (!destAccount) throw new Error('Please verify recipient account');
        return api.transfer(accId, destAccount.id, amountPaise, note);
      }
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      const meta = res?.meta;
      const ref = res?.data?.transaction?.reference || 'Processed';
      setActionSuccess(
        `Transaction committed! Ref: ${ref} (Processed by Node ${meta?.processedBy ?? 1}, Lamport=${meta?.lamport ?? 0})`
      );
      setModalType(null);
      setNote('');
      setDestAccount(null);
      setDestAccountLookup('');
    },
    onError: (err: any) => {
      setActionError(err.message || 'Transaction failed');
    },
  });

  return (
    <div className="space-y-8">
      {/* Top Banner & Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Balance Card */}
        <div className="md:col-span-2 glass-panel p-6 rounded-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Available Balance</p>
              <div className="mt-2 text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                {accountsLoading ? (
                  <span className="text-slate-600 animate-pulse">₹ --</span>
                ) : (
                  <MoneyDisplay paise={totalPaise} />
                )}
              </div>
            </div>
            <span className="p-3 bg-indigo-900/60 border border-indigo-700/50 rounded-xl text-indigo-400">
              <CreditCard className="w-6 h-6" />
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setModalType('deposit');
                setSelectedAccountId(accounts[0]?.id || '');
                setActionError(null);
              }}
              disabled={accounts.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
            >
              <ArrowDownRight className="w-4 h-4" />
              Deposit
            </button>
            <button
              onClick={() => {
                setModalType('withdraw');
                setSelectedAccountId(accounts[0]?.id || '');
                setActionError(null);
              }}
              disabled={accounts.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition disabled:opacity-50"
            >
              <ArrowUpRight className="w-4 h-4" />
              Withdraw
            </button>
            <button
              onClick={() => {
                setModalType('transfer');
                setSelectedAccountId(accounts[0]?.id || '');
                setActionError(null);
              }}
              disabled={accounts.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm disabled:opacity-50"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Transfer
            </button>
          </div>
        </div>

        {/* Account Count & Quick Info Card */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active Accounts</p>
            <div className="mt-2 text-3xl font-extrabold text-white">
              {accounts.length}
            </div>
            <p className="text-xs text-slate-500 mt-1">Replicated across 3 PostgreSQL instances</p>
          </div>
          <Link
            to="/accounts"
            className="mt-6 inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-white font-medium text-sm transition"
          >
            <Plus className="w-4 h-4" />
            Manage & Open Accounts
          </Link>
        </div>
      </div>

      {/* Success Notification */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-sm flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-white font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Accounts & Recent Transactions Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accounts List */}
        <div className="lg:col-span-1 glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-base">Your Accounts</h3>
            <Link to="/accounts" className="text-xs text-indigo-400 hover:underline">
              View all
            </Link>
          </div>

          {accounts.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No accounts created yet.
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((acc) => (
                <Link
                  key={acc.id}
                  to={`/accounts/${acc.id}`}
                  className="block p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-semibold text-white">{acc.nickname || 'Standard Account'}</p>
                      <p className="text-xs font-mono text-slate-400 mt-0.5">
                        {acc.accountNumber.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
                      </p>
                    </div>
                    <StatusBadge status={acc.status} />
                  </div>
                  <div className="mt-3 text-lg font-bold text-white">
                    <MoneyDisplay paise={acc.balancePaise} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Transactions Table */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white text-base">Recent Transactions</h3>
            <Link to="/transactions" className="text-xs text-indigo-400 hover:underline">
              Full History
            </Link>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No recent transactions recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="pb-3">Type</th>
                    <th className="pb-3">Amount</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Node / Lamport</th>
                    <th className="pb-3">Time</th>
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
                          <span className="text-xs text-slate-500 font-mono">L={tx.lamport}</span>
                        </div>
                      </td>
                      <td className="py-3 text-xs text-slate-400">
                        {new Date(tx.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Action Modal (Deposit / Withdraw / Transfer) */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white capitalize">{modalType} Funds</h3>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-sm">
                {actionError}
              </div>
            )}

            {/* Source Account Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Source Account</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.nickname || acc.accountNumber} — ₹{(acc.balancePaise / 100).toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

            {/* Recipient Lookup for Transfer */}
            {modalType === 'transfer' && (
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                  Recipient Account Number
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={destAccountLookup}
                    onChange={(e) => setDestAccountLookup(e.target.value)}
                    placeholder="12-digit number"
                    className="flex-1 p-2.5 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={lookupLoading}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-white font-medium"
                  >
                    {lookupLoading ? 'Checking...' : 'Lookup'}
                  </button>
                </div>
                {destAccount && (
                  <p className="text-xs text-emerald-400 mt-1">Verified: {destAccount.holderMasked}</p>
                )}
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Amount</label>
              <MoneyInput valuePaise={amountPaise} onChangePaise={setAmountPaise} />
            </div>

            {/* Note */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Note (Optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Rent, Groceries"
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => txnMutation.mutate()}
                disabled={txnMutation.isPending || (modalType === 'transfer' && !destAccount)}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {txnMutation.isPending ? 'Processing...' : 'Submit Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
