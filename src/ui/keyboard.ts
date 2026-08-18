/**
 * Keyboard navigation. Stepping an hour at a time is the natural way to watch
 * a day unfold, and clicking 24 buttons to do it is not.
 *
 * Left/right step the hour and roll over into the neighbouring day; up/down
 * step the day; `[` and `]` move between locations; `?` opens the index.
 */
export interface KeyboardActions {
  stepHour: (delta: number) => void;
  stepDay: (delta: number) => void;
  stepLocation: (delta: number) => void;
  toggleIndex: () => void;
}

const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function initKeyboard(actions: KeyboardActions): void {
  document.addEventListener('keydown', (event) => {
    // Never steal keys from a focused field or an in-progress shortcut.
    const target = event.target as HTMLElement | null;
    if (target && IGNORE_TAGS.has(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case 'ArrowLeft':
        actions.stepHour(-1);
        break;
      case 'ArrowRight':
        actions.stepHour(1);
        break;
      case 'ArrowUp':
        actions.stepDay(-1);
        break;
      case 'ArrowDown':
        actions.stepDay(1);
        break;
      case '[':
        actions.stepLocation(-1);
        break;
      case ']':
        actions.stepLocation(1);
        break;
      case '?':
        actions.toggleIndex();
        break;
      case 'Escape':
        actions.toggleIndex();
        return; // Escape should close, and never scroll.
      default:
        return;
    }
    event.preventDefault();
  });
}
