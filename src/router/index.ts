import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guest: true }
    },
    {
      path: '/auth/verify',
      name: 'verify',
      component: () => import('@/views/VerifyView.vue'),
      meta: { guest: true }
    },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'chat', name: 'chat', component: () => import('@/views/ChatView.vue') },
        { path: 'kanban', name: 'kanban', component: () => import('@/views/KanbanView.vue') },
        { path: 'calendar', name: 'calendar', component: () => import('@/views/CalendarView.vue') },
        { path: 'files', name: 'files', component: () => import('@/views/FilesView.vue') },
        { path: 'reminders', name: 'reminders', component: () => import('@/views/RemindersView.vue') },
        { path: 'knowledge', name: 'knowledge', component: () => import('@/views/KnowledgeView.vue') },
        { path: 'monitoring', name: 'monitoring', component: () => import('@/views/MonitoringView.vue') },
        { path: 'email', name: 'email', component: () => import('@/views/EmailView.vue') },
        { path: 'passwords', name: 'passwords', component: () => import('@/views/PasswordsView.vue') },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue') }
      ]
    }
  ]
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()
  
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next('/login')
  } else if (to.meta.guest && auth.isAuthenticated) {
    next('/chat')
  } else {
    next()
  }
})

export default router
