import { Route, Routes } from '@angular/router';
import { confirmLeave } from './shared/leave-guard';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/** Ekrany kont – dostępne bez sesji */
const guest = (path: string, title: string, loadComponent: Route['loadComponent']): Route => ({ path, title: `${title} – ClimbProgress`, canActivate: [guestGuard], loadComponent });

export const routes: Routes = [
  guest('login', 'Logowanie', () => import('./features/auth/login').then((m) => m.LoginComponent)),
  guest('register', 'Rejestracja', () => import('./features/auth/register').then((m) => m.RegisterComponent)),
  guest('forgot-password', 'Odzyskiwanie hasła', () => import('./features/auth/forgot-password').then((m) => m.ForgotPasswordComponent)),
  guest('reset-password', 'Nowe hasło', () => import('./features/auth/reset-password').then((m) => m.ResetPasswordComponent)),
  { path: 'verify-email', title: 'Potwierdź email – ClimbProgress', loadComponent: () => import('./features/auth/verify-email').then((m) => m.VerifyEmailComponent) },
  {
    // Wszystkie widoki aplikacji wymagają aktywnej sesji
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', title: 'ClimbProgress', loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'plan', title: 'Plan – ClimbProgress', loadComponent: () => import('./features/plan/plan').then((m) => m.PlanPage) },
      { path: 'history', title: 'Historia – ClimbProgress', loadComponent: () => import('./features/history/history').then((m) => m.HistoryPage) },
      { path: 'history/:id', title: 'Trening – ClimbProgress', loadComponent: () => import('./features/history/workout-detail').then((m) => m.WorkoutDetail) },
      { path: 'tests/:id', title: 'Test – ClimbProgress', loadComponent: () => import('./features/test/test-report').then((m) => m.TestReportPage) },
      { path: 'progress', title: 'Progres – ClimbProgress', loadComponent: () => import('./features/progress/progress').then((m) => m.ProgressPage) },
      { path: 'profile', title: 'Profil – ClimbProgress', loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage) },
      { path: 'readiness', title: 'Gotowość – ClimbProgress', loadComponent: () => import('./features/readiness/readiness').then((m) => m.ReadinessPage) },
      { path: 'session/:id', title: 'Trening – ClimbProgress', canDeactivate: [confirmLeave], loadComponent: () => import('./features/session/session').then((m) => m.SessionPage) },
      { path: 'assessment/demo', title: 'Demo Baseline Test – ClimbProgress', data: { demo: true }, loadComponent: () => import('./features/assessment/assessment-report').then((m) => m.AssessmentReportPage) },
      { path: 'assessment/run/:id', title: 'Test Mode – ClimbProgress', canDeactivate: [confirmLeave], loadComponent: () => import('./features/assessment/assessment-run').then((m) => m.AssessmentRunPage) },
      { path: 'assessment/:id', title: 'Raport testu – ClimbProgress', loadComponent: () => import('./features/assessment/assessment-report').then((m) => m.AssessmentReportPage) },
      { path: 'test/:id', title: 'Test – ClimbProgress', loadComponent: () => import('./features/test/test-session').then((m) => m.TestSessionPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
