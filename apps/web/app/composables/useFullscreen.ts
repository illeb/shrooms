/**
 * Schermo intero via Fullscreen API su un elemento.
 *
 * L'API vera e non un finto overlay a `position: fixed`: cosi' la mappa
 * guadagna anche i pixel della barra del browser, Esc esce da solo e il
 * sistema operativo tratta la finestra come si aspetta chi la usa.
 *
 * Restituisce anche `element`, il ref da attaccare al contenitore: chi la usa
 * non deve tenere due ref allineati a mano.
 */
export function useFullscreen() {
  const element = ref<HTMLElement | null>(null);
  const isFullscreen = ref(false);

  function sync(): void {
    isFullscreen.value = document.fullscreenElement === element.value;
  }

  async function toggle(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (element.value) await element.value.requestFullscreen();
    } catch (error) {
      // Il browser puo' rifiutare - permessi, iframe senza allowfullscreen -
      // e non e' un errore di chi ci sta dentro, che resta usabile com'e'.
      console.warn('Schermo intero non disponibile:', error);
    }
  }

  onMounted(() => document.addEventListener('fullscreenchange', sync));
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', sync));

  return { element, isFullscreen, toggle };
}
