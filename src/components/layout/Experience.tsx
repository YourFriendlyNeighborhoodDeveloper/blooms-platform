import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

type ExperienceState = {
  introDone: boolean;
  finishIntro: () => void;
  petals: boolean;
  setPetals: (on: boolean) => void;
  reduceMotion: boolean;
};

const ExperienceContext = createContext<ExperienceState | null>(null);

const INTRO_KEY = 'blooms-intro-seen';
const PETALS_KEY = 'blooms-petals';

function readStorage(store: 'session' | 'local', key: string) {
  try {
    return (store === 'session' ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(store: 'session' | 'local', key: string, value: string) {
  try {
    (store === 'session' ? sessionStorage : localStorage).setItem(key, value);
  } catch {
    /* storage unavailable (private mode, blocked) — the experience still works */
  }
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion() ?? false;
  const [introDone, setIntroDone] = useState(() => reduceMotion || readStorage('session', INTRO_KEY) === '1');
  const [petalsPref, setPetalsPref] = useState(() => readStorage('local', PETALS_KEY) !== 'off');

  const finishIntro = useCallback(() => {
    setIntroDone(true);
    writeStorage('session', INTRO_KEY, '1');
  }, []);

  const setPetals = useCallback((on: boolean) => {
    setPetalsPref(on);
    writeStorage('local', PETALS_KEY, on ? 'on' : 'off');
  }, []);

  useEffect(() => {
    if (reduceMotion) setIntroDone(true);
  }, [reduceMotion]);

  const value = useMemo(
    () => ({ introDone, finishIntro, petals: petalsPref && !reduceMotion, setPetals, reduceMotion }),
    [introDone, finishIntro, petalsPref, reduceMotion, setPetals],
  );

  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

export function useExperience() {
  const ctx = useContext(ExperienceContext);
  if (!ctx) throw new Error('useExperience must be used inside ExperienceProvider');
  return ctx;
}
