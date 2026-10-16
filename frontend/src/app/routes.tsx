import { createBrowserRouter } from 'react-router';
import { PlayPage } from './pages/PlayPage';
import { EditPage } from './pages/EditPage';
import { DashboardPage } from './pages/DashboardPage';
import { IS_HOSTED } from './utils/mode';

const routeConfig = [
  { path: '/',          Component: PlayPage },
  { path: '/editor',    Component: EditPage },
  { path: '/dashboard', Component: DashboardPage },
];

export const router = createBrowserRouter(routeConfig, {
  basename: IS_HOSTED ? '/' : '/I-DOJO',
});
