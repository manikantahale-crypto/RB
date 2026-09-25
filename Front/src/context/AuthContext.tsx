import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import * as authService from '../services/auth';

const TOKEN_KEY = 'syntra_auth_token';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const restoreSession = async () => {
      let savedToken = localStorage.getItem(TOKEN_KEY);
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = urlParams.get('token');
      if (queryToken) {
        savedToken = queryToken;
        localStorage.setItem(TOKEN_KEY, queryToken);
        const cleanSearch = new URLSearchParams(window.location.search);
        cleanSearch.delete('token');
        const searchStr = cleanSearch.toString() ? `?${cleanSearch.toString()}` : '';
        window.history.replaceState(null, '', `${window.location.pathname}${searchStr}${window.location.hash}`);
      }

      if (!savedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const { user: restoredUser } = await authService.getMe(savedToken);
        setUser(restoredUser);
        setToken(savedToken);
      } catch (err) {
        console.warn('Session restoration failed:', err);
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authService.login(email, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
    setToken(res.token);
  };

  const signup = async (fullName: string, email: string, password: string) => {
    const res = await authService.signup(fullName, email, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
    setToken(res.token);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
