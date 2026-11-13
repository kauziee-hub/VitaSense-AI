import { useEffect, useState } from 'react';
import { WelcomeScreen } from './screens/Welcome';
import { DashboardScreen } from './screens/Dashboard';
import { OnboardingScreen } from './screens/Onboarding';
import { DailyRoutineScreen } from './screens/DailyRoutine';
import { ProfileScreen } from './screens/Profile';
import { ChatbotScreen } from './screens/Chatbot';
import { AreaHealthMapScreen } from './screens/AreaHealthMap';
import Layout from './components/Layout';
import { AnimatePresence } from 'motion/react';
import type { AppUser } from './lib/api';

type Screen = 'welcome' | 'dashboard' | 'onboarding' | 'routine' | 'profile' | 'chatbot' | 'calendar';
const ACTIVE_USER_KEY = 'vitasense.activeUser';

function readStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppUser;
    const legacyName = parsed.name?.trim().toLowerCase();
    const legacyCode = parsed.user_code?.trim().toLowerCase();
    if (legacyName?.includes('samantha') || legacyCode === 'demo-user') {
      localStorage.removeItem(ACTIVE_USER_KEY);
      return null;
    }
    return typeof parsed.id === 'number' && parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [activeUser, setActiveUser] = useState<AppUser | null>(() => readStoredUser());

  useEffect(() => {
    if (activeUser) {
      localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(activeUser));
      if (currentScreen === 'welcome') setCurrentScreen('dashboard');
    } else {
      localStorage.removeItem(ACTIVE_USER_KEY);
    }
  }, [activeUser, currentScreen]);

  const handleNavigate = (screen: string) => {
    if (screen === 'welcome') {
      setActiveUser(null);
    }
    setCurrentScreen(screen as Screen);
  };

  if (currentScreen === 'welcome' || !activeUser) {
    return (
      <WelcomeScreen
        onSelectUser={(user, mode) => {
          setActiveUser(user);
          setCurrentScreen(mode === 'new' ? 'onboarding' : 'dashboard');
        }}
      />
    );
  }

  if (currentScreen === 'onboarding') {
    return <OnboardingScreen user={activeUser} onComplete={() => setCurrentScreen('dashboard')} onCancel={() => setCurrentScreen('dashboard')} />;
  }

  return (
    <Layout activeScreen={currentScreen} onNavigate={handleNavigate} user={activeUser} title={
      currentScreen === 'routine' ? 'Daily Routine' : 
      currentScreen === 'calendar' ? 'Area Health Map' :
      currentScreen === 'chatbot' ? 'Chatbot' :
      currentScreen === 'profile' ? 'Profile' : 
      'VitaSense AI'
    }>
      <AnimatePresence mode="wait">
        {currentScreen === 'dashboard' && <DashboardScreen user={activeUser} onAction={handleNavigate} />}
        {currentScreen === 'routine' && <DailyRoutineScreen userId={activeUser.id} />}
        {currentScreen === 'profile' && <ProfileScreen user={activeUser} onEdit={() => setCurrentScreen('onboarding')} />}
        {currentScreen === 'chatbot' && <ChatbotScreen user={activeUser} />}
        {currentScreen === 'calendar' && <AreaHealthMapScreen userId={activeUser.id} />}
      </AnimatePresence>
    </Layout>
  );
}
