import { createClient } from '@supabase/supabase-js';

// Varsayılan olarak boş başlatıyoruz
let supabase = null;

// Sinyalizasyon ve veritabanı için Supabase başlatma
export const initSupabase = async () => {
  if (supabase) return supabase;

  try {
    // Electron'dan env değişkenlerini al
    const envVars = await window.electronAPI.getEnvVars();
    
    const supabaseUrl = envVars.SUPABASE_URL;
    const supabaseAnonKey = envVars.SUPABASE_ANON_KEY;

    if (!supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_URL_HERE' || !supabaseAnonKey) {
      console.warn('⚠️ Supabase URL veya Anon Key bulunamadı. Lütfen .env dosyanızı güncelleyin.');
      return null;
    }

    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10 // Anlık mesaj limitini ayarlayabiliriz
        }
      }
    });

    console.log('✅ Supabase Client başarıyla başlatıldı!');
    return supabase;
  } catch (error) {
    console.error('❌ Supabase başlatılırken hata oluştu:', error);
    return null;
  }
};

export const getSupabase = () => supabase;
