// apps/frontend/app/beta/page.tsx
import { redirect } from 'next/navigation';

// Beta program is closed — redirect to the main page
export default function BetaLandingPage() {
  redirect('/');
}