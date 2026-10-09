import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { MoneyDisplay } from '../../components/common/money-display';
import { MoneyInput } from '../../components/common/money-input';
import { StatusBadge } from '../../components/common/status-badge';
import { Link } from 'react-router-dom';
import { CreditCard, Plus, ArrowRight } from 'lucide-react';

export const AccountsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [nickname, setNickname] = useState('');
  const [initialDepositPaise, setInitialDepositPaise] = useState(100000); // ₹1,000
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await api.listAccounts();
      return res.data?.accounts || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.createAccount(nickname.trim() || undefined, initialDepositPaise);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setShowCreate(false);
      setNickname('');
      setInitialDepositPaise(100000);
      setError(null);
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to open account');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Your Bank Accounts</h2>
          <p className="text-sm text-slate-400 mt-1">Manage replicated checking and savings accounts</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Open New Account
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="glass-panel p-6 rounded-2xl h-44 animate-pulse bg-slate-800/40" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl text-center space-y-4">
          <CreditCard className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-lg font-semibold text-white">No Accounts Found</h3>
          <p className="text-sm text-slate-400 max-w-sm mx-auto">
            Get started by opening your first distributed bank account.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition"
          >
            Create an Account Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="glass-panel p-6 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition group"
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <span className="p-2.5 rounded-xl bg-slate-800 text-indigo-400">
                    <CreditCard className="w-5 h-5" />
                  </span>
                  <StatusBadge status={acc.status} />
                </div>
                <h4 className="font-semibold text-white text-base">{acc.nickname || 'Standard Account'}</h4>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  {acc.accountNumber.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase font-semibold">Balance</p>
                  <p className="text-xl font-bold text-white mt-0.5">
                    <MoneyDisplay paise={acc.balancePaise} />
                  </p>
                </div>
                <Link
                  to={`/accounts/${acc.id}`}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                >
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Account Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Open New Bank Account</h3>

            {error && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                Account Nickname (Optional)
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g. Savings, Emergency Fund"
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                Initial Deposit
              </label>
              <MoneyInput valuePaise={initialDepositPaise} onChangePaise={setInitialDepositPaise} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {createMutation.isPending ? 'Opening...' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
