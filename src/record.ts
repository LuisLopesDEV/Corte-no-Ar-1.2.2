const RECORD_KEY = 'cacco-corte-best'

export function loadRecord() {
  try {
    const value = Number(localStorage.getItem(RECORD_KEY))
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function saveRecord(score: number) {
  try {
    localStorage.setItem(RECORD_KEY, String(score))
  } catch {
    // O recorde da sessão ainda fica disponível no controlador.
  }
}
