import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { MoneyDisplay } from '../../components/common/money-display';
import { MoneyInput } from '../../components/common/money-input';
import { StatusBadge } from '../../components/common/status-badge';
import { NodeBadge } from '../../components/common/node-badge';
import {
  ArrowLeft,
  Download,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  CreditCard,
} from 'lucide-react';

export const AccountDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [modalType, setModalType] = useState<'deposit' | 'withdraw' | 'transfer' | null>(null);
  const [amountPaise, setAmountPaise] = useState<number>(5000);
  const [note, setNote] = useState<string>('');
  const [destAccountLookup, setDestAccountLookup] = useState<string>('');
  const [destAccount, setDestAccount] = useState<{ id: string; holderMasked: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch account detail
  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: ['account', id],
    queryFn: async () => {
      if (!id) return null;
      const res = await api.getAccount(id);
      return res.data?.account || null;
    },
    enabled: Boolean(id),
  });

  // Fetch transactions for this account
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', 'account', id],
    queryFn: async () => {
      if (!id) return [];
      const res = await api.listTransactions({ accountId: id, limit: 30 });
      return res.data?.transactions || [];
    },
    enabled: Boolean(id),
  });

  // Handle destination lookup
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
      if (!id) throw new Error('Account ID missing');
      if (modalType === 'deposit') {
        return api.deposit(id, amountPaise, note);
      } else if (modalType === 'withdraw') {
        return api.withdraw(id, amountPaise, note);
      } else if (modalType === 'transfer') {
        if (!destAccount) throw new Error('Please verify recipient account');
        return api.transfer(id, destAccount.id, amountPaise, note);
      }
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['account', id] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      const meta = res?.meta;
      const ref = res?.data?.transaction?.reference || 'Committed';
      setActionSuccess(
        `Transaction committed! Ref: ${ref} (Node ${meta?.processedBy ?? 1}, L=${meta?.lamport ?? 0})`
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

  // Download statement CSV directly via authenticated link
  const handleDownloadCsv = () => {
    if (!id) return;
    const token = sessionStorage.getItem('dbs_token');
    fetch(`/api/accounts/${id}/statement.csv`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `statement-${account?.accountNumber || id}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch((err) => {
        console.error('Download statement failed', err);
      });
  };

  if (accountLoading) {
    return <div className="p-8 text-center text-slate-500">Loading account details...</div>;
  }

  if (!account) {
    return (
      <div className="p-8 text-center">
        <p className="text-rose-400">Account not found.</p>
        <Link to="/accounts" className="text-indigo-400 underline mt-2 inline-block">
          Back to accounts
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <Link
          to="/accounts"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Accounts
        </Link>
      </div>

      {/* Account Header Banner */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-slate-800 text-indigo-400">
              <CreditCard className="w-6 h-6" />
            </span>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {account.nickname || 'Standard Account'}
              </h2>
              <p className="text-sm font-mono text-slate-400">
                {account.accountNumber.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
              </p>
            </div>
            <StatusBadge status={account.status} />
          </div>

          <div className="mt-4 flex items-center gap-6 text-xs text-slate-400">
            <span>Version: v{account.version}</span>
            <span>Currency: {account.currency}</span>
            <span>Opened: {new Date(account.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-3">
          <p className="text-xs uppercase text-slate-400 font-semibold">Available Balance</p>
          <div className="text-3xl font-extrabold text-white tracking-tight">
            <MoneyDisplay paise={account.balancePaise} />
          </div>
          <button
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
          >
            <Download className="w-3.5 h-3.5" />
            Download Statement (CSV)
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setModalType('deposit');
            setActionError(null);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-sm"
        >
          <ArrowDownRight className="w-4 h-4" />
          Deposit
        </button>
        <button
          onClick={() => {
            setModalType('withdraw');
            setActionError(null);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-sm transition"
        >
          <ArrowUpRight className="w-4 h-4" />
          Withdraw
        </button>
        <button
          onClick={() => {
            setModalType('transfer');
            setActionError(null);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm"
        >
          <ArrowLeftRight className="w-4 h-4" />
          Transfer
        </button>
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

      {/* Transaction History for this Account */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <h3 className="font-bold text-white text-base">Account Transaction History</h3>

        {transactions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            No transactions found for this account.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Balance After</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Processed By</th>
                  <th className="pb-3">Reference / Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {transactions.map((tx) => {
                  const isSource = tx.sourceAccountId === account.id;
                  const isOutgoing = tx.type === 'WITHDRAWAL' || (tx.type === 'TRANSFER' && isSource);
                  const balanceAfter = isSource ? tx.sourceBalanceAfter : tx.destinationBalanceAfter;

                  return (
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
                          sign={!isOutgoing}
                          className={isOutgoing ? 'text-rose-400' : 'text-emerald-400'}
                        />
                      </td>
                      <td className="py-3 font-mono text-xs text-slate-300">
                        {balanceAfter !== undefined && balanceAfter !== null ? (
                          <MoneyDisplay paise={balanceAfter} />
                        ) : (
                          '--'
                        )}
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
                      <td className="py-3 text-xs">
                        <div className="text-slate-300 font-mono">{tx.reference}</div>
                        <div className="text-slate-500">{new Date(tx.createdAt).toLocaleString()}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white capitalize">{modalType} Funds</h3>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-sm">
                {actionError}
              </div>
            )}

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
                placeholder="e.g. Rent, Payment"
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
                {txnMutation.isPending ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
