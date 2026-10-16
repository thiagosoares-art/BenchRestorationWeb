import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { RestoreProvider } from './contexts/RestoreContext'
import { BatchProvider } from './contexts/BatchContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingSkeleton from './components/LoadingSkeleton'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RestorePage = lazy(() => import('./pages/RestorePage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const DeletePage = lazy(() => import('./pages/DeletePage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const ServerSizePage = lazy(() => import('./pages/ServerSizePage'))
const QueuePage = lazy(() => import('./pages/QueuePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const BatchRestorePage = lazy(() => import('./pages/BatchRestorePage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
})

function PageLoader() {
  return (
    <div className="p-6">
      <LoadingSkeleton lines={5} />
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />

  return <>{children}</>
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <RestoreProvider>
            <BatchProvider>
              <ErrorBoundary>
                <Toaster
                  position="top-right"
                  toastOptions={{
                    duration: 4000,
                    style: {
                      borderRadius: '12px',
                      padding: '12px 16px',
                    },
                    success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
                    error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
                  }}
                />
                <Routes>
                  <Route path="/login" element={
                    <Suspense fallback={<PageLoader />}>
                      <LoginPage />
                    </Suspense>
                  } />
                  <Route path="/" element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }>
                    <Route index element={<Suspense fallback={<PageLoader />}><RestorePage /></Suspense>} />
                    <Route path="history" element={<Suspense fallback={<PageLoader />}><HistoryPage /></Suspense>} />
                    <Route path="settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
                    <Route path="delete" element={<Suspense fallback={<PageLoader />}><DeletePage /></Suspense>} />
                    <Route path="server-size" element={<Suspense fallback={<PageLoader />}><ServerSizePage /></Suspense>} />
                    <Route path="queue" element={<Suspense fallback={<PageLoader />}><QueuePage /></Suspense>} />
                    <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
                    <Route path="batch" element={<Suspense fallback={<PageLoader />}><BatchRestorePage /></Suspense>} />
                    <Route path="about" element={<Suspense fallback={<PageLoader />}><AboutPage /></Suspense>} />
                  </Route>
                </Routes>
              </ErrorBoundary>
            </BatchProvider>
          </RestoreProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
