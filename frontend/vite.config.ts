import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 : sinon Vite n'écoute que sur la boucle locale du conteneur et
    // nginx ne peut pas l'atteindre.
    host: '0.0.0.0',
    port: 5173,
    // Le rechargement à chaud doit être joignable depuis le navigateur de
    // l'hôte, qui passe par nginx sur le port 8080. Sans ce bloc, le client HMR
    // tente de se connecter au port interne du conteneur et échoue en silence :
    // la page se charge, mais les modifications ne s'appliquent jamais.
    hmr: { clientPort: 8080 },
    // Le montage en volume masque les événements inotify sur certains systèmes
    // de fichiers ; l'interrogation périodique est le contournement fiable.
    watch: { usePolling: true },
  },
})
