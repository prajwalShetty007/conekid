import Phaser from "phaser";
import { ConeKidScene } from "./game/ConeKidScene";
import "./style.css";

const container = document.querySelector<HTMLDivElement>("#app");

if (!container) {
  throw new Error("Missing #app container.");
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: container,
  width: 1024,
  height: 720,
  backgroundColor: "#86b6de",
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 900, x: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [ConeKidScene],
};

// The game instance is intentionally assigned to a variable to make it easier to
// inspect from browser devtools during development.
const game = new Phaser.Game(config);

void game;
