import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Notice, Spinner, StorePage } from '../../shop/ui';

export default function Verify() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    // The link is single-use, so it must not fire twice under StrictMode.
    if (started.current) return;
    started.current = true;
    api('/api/account/verify', { body: { token } })
      .then(() => navigate('/account', { replace: true }))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'That link did not work.'));
  }, [token, navigate]);
  return (
    <StorePage narrow title={error ? 'That link did not work' : 'Signing you in…'}>
      {error ? (
        <>
          <Notice>{error}</Notice>
          <div className="mt-6">
            <Button to="/account">Request a new link</Button>
          </div>
        </>
      ) : (
        <Spinner label="One moment…" />
      )}
    </StorePage>
  );
}
