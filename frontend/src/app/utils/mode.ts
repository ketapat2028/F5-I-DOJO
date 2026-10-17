export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE ?? '';
// build:hosted (Netlify) ใช้ --mode hosted — บน Pi ไม่ใช่ทั้งคู่ จึงได้ basename '/I-DOJO'
export const IS_HOSTED = import.meta.env.MODE === 'hosted' || DEMO_MODE === 'hosted';
