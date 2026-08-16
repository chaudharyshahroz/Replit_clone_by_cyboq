import { redirect } from 'next/navigation';

/** The app root is an alias for the workspace home. */
export default function AppIndex() {
  redirect('/home');
}
