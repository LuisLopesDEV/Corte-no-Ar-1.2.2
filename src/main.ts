import './style.css'
import { GameView } from './game-view.js'
import { MatchController } from './match-controller.js'

const view = new GameView()
const debug = new URLSearchParams(location.search).get('debug') === '1'
if (debug) {
  const { addTrackingDiagnostics } = await import('./tracking-debug.js')
  new MatchController(view, addTrackingDiagnostics()).start()
} else {
  new MatchController(view).start()
}
