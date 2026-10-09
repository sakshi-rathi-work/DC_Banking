import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/auth-context';
import { AppLayout } from './components/layout/app-layout';

// Banking pages
import { LoginPage } from './pages/auth/login-page';
import { RegisterPage } from './pages/auth/register-page';
import { DashboardPage } from './pages/banking/dashboard-page';
import { AccountsPage } from './pages/banking/accounts-page';
import { AccountDetailPage } from './pages/banking/account-detail-page';
import { TransactionsPage } from './pages/banking/transactions-page';

// Lab pages
import { ClusterOverviewPage } from './pages/cluster/cluster-overview-page';
import { RpcLabPage } from './pages/lab/rpc-lab-page';
import { ConcurrencyLabPage } from './pages/lab/concurrency-lab-page';
import { PhysicalClockLabPage } from './pages/lab/physical-clock-lab-page';
import { LogicalClockLabPage } from './pages/lab/logical-clock-lab-page';
import { BullyLabPage } from './pages/lab/bully-lab-page';
import { RingLabPage } from './pages/lab/ring-lab-page';
import { ReplicationLabPage } from './pages/lab/replication-lab-page';
import { LoadBalancingLabPage } from './pages/lab/load-balancing-lab-page';
import { FaultToleranceLabPage } from './pages/lab/fault-tolerance-lab-page';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const ProtectedBankingRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-12 text-center text-slate-500">Checking credentials...</div>;
  }
  if (!user && !sessionStorage.getItem('dbs_token')) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route path="/" element={<AppLayout />}>
              {/* Banking Routes */}
              <Route
                index
                element={
                  <ProtectedBankingRoute>
                    <DashboardPage />
                  </ProtectedBankingRoute>
                }
              />
              <Route
                path="accounts"
                element={
                  <ProtectedBankingRoute>
                    <AccountsPage />
                  </ProtectedBankingRoute>
                }
              />
              <Route
                path="accounts/:id"
                element={
                  <ProtectedBankingRoute>
                    <AccountDetailPage />
                  </ProtectedBankingRoute>
                }
              />
              <Route
                path="transactions"
                element={
                  <ProtectedBankingRoute>
                    <TransactionsPage />
                  </ProtectedBankingRoute>
                }
              />

              {/* Distributed Lab Routes */}
              <Route path="cluster" element={<ClusterOverviewPage />} />
              <Route path="lab/rpc" element={<RpcLabPage />} />
              <Route path="lab/concurrency" element={<ConcurrencyLabPage />} />
              <Route path="lab/physical-clock" element={<PhysicalClockLabPage />} />
              <Route path="lab/logical-clock" element={<LogicalClockLabPage />} />
              <Route path="lab/bully" element={<BullyLabPage />} />
              <Route path="lab/ring" element={<RingLabPage />} />
              <Route path="lab/replication" element={<ReplicationLabPage />} />
              <Route path="lab/load-balancing" element={<LoadBalancingLabPage />} />
              <Route path="lab/fault-tolerance" element={<FaultToleranceLabPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};
