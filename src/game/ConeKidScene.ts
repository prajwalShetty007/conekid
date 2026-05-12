
import Phaser from "phaser";
import { hardRockAudio } from "./HardRockAudio";

const WORLD_HEIGHT = 720;
const TILE_WIDTH = 64;
const BASE_GROUND_Y = 696;
const PLAYER_SPEED = 225;
const JUMP_SPEED = -440;
const MAX_LIVES = 3;
const MAX_HP = 5;

type ArcadeSprite = Phaser.Physics.Arcade.Sprite;
type EnemyType = "bolt" | "chicken";
type ExitType = "house" | "palace";
type Theme = "village" | "cave" | "heaven";

interface Vec2 {
  x: number;
  y: number;
}

interface Segment {
  x: number;
  width: number;
  y?: number;
}

interface LavaZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EnemySpec extends Vec2 {
  type: EnemyType;
}

interface VillagerSpec extends Vec2 {
  texture: "villager-boy" | "villager-girl";
  tint: number;
  message: string;
}

interface LevelConfig {
  number: 1 | 2 | 3;
  name: string;
  theme: Theme;
  width: number;
  spawn: Vec2;
  requiredBearings: number;
  requiredDefeats: number;
  groundSegments: Segment[];
  platforms: Vec2[];
  bearings: Vec2[];
  crates: Vec2[];
  enemies: EnemySpec[];
  villagers: VillagerSpec[];
  lavaZones: LavaZone[];
  exit: Vec2;
  exitType: ExitType;
}

interface SceneData {
  level?: 1 | 2 | 3;
  lives?: number;
  totalBearings?: number;
}

export class ConeKidScene extends Phaser.Scene {
  private levelNumber: 1 | 2 | 3 = 1;
  private config!: LevelConfig;

  private lives = MAX_LIVES;
  private hp = MAX_HP;
  private totalBearings = 0;

  private bearingsCollected = 0;
  private enemiesDefeated = 0;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private attackKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private answerOneKey!: Phaser.Input.Keyboard.Key;
  private answerTwoKey!: Phaser.Input.Keyboard.Key;
  private answerThreeKey!: Phaser.Input.Keyboard.Key;

  private player!: ArcadeSprite;
  private facing: -1 | 1 = 1;
  private isAttacking = false;
  private invulnerableUntil = 0;
  private lastJumpTapAt = -9999;
  private boosterUsedThisAir = false;

  private carryingCrate: ArcadeSprite | null = null;

  private ground!: Phaser.Physics.Arcade.StaticGroup;
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.StaticGroup;
  private bearings!: Phaser.Physics.Arcade.Group;
  private crates!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;

  private villagers: Phaser.GameObjects.Image[] = [];

  private hudText!: Phaser.GameObjects.Text;
  private taskText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;

  private promptLockUntil = 0;
  private transitioning = false;
  private gameFinished = false;
  private gameOver = false;
  private fairyRiddleActive = false;
  private fairyOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("cone-kid-scene");
  }

  init(data: SceneData): void {
    this.levelNumber = data.level ?? 1;
    this.lives = data.lives ?? MAX_LIVES;
    this.totalBearings = data.totalBearings ?? 0;
    this.hp = MAX_HP;
    this.bearingsCollected = 0;
    this.enemiesDefeated = 0;
    this.transitioning = false;
    this.gameFinished = false;
    this.gameOver = false;
    this.fairyRiddleActive = false;
    this.fairyOverlay = null;
    this.promptLockUntil = 0;
    this.carryingCrate = null;
    this.facing = 1;
  }

  preload(): void {
    this.createRuntimeTextures();
    this.load.image("bolt-brute-lava", "bolt-brute-level2.png");
  }

  create(): void {
    this.config = this.getLevelConfig(this.levelNumber);
    this.physics.world.setBounds(0, 0, this.config.width, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, this.config.width, WORLD_HEIGHT);

    this.buildBackground();
    this.buildTerrain();
    this.buildInteractables();
    this.buildEnemies();
    this.buildVillagers();
    this.buildExit();
    this.buildPlayer();
    this.setupCollisions();
    this.setupInput();
    this.createHud();

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // Audio starts on first user gesture (browser autoplay policy).
    this.input.once("pointerdown", () => hardRockAudio.start());
    this.input.keyboard?.once("keydown", () => hardRockAudio.start());

    this.showPrompt(this.levelIntroText(), 3000);
  }

  update(time: number): void {
    if (this.gameOver || this.gameFinished) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart({ level: 1, lives: MAX_LIVES, totalBearings: 0 });
      }
      return;
    }

    if (this.fairyRiddleActive) {
      this.handleFairyRiddleInput();
      return;
    }

    this.handleMovement(time);

    if (!this.transitioning && Phaser.Input.Keyboard.JustDown(this.attackKey)) {
      this.performAttack();
    }

    if (!this.transitioning && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.handleInteract();
    }

    this.updateCarriedCrate();
    this.updateEnemyAI(time);
    this.updateAmbientPrompt();
    this.checkExit();
    this.updateHud();

    if (this.player.y > WORLD_HEIGHT + 80) {
      this.damagePlayer(99, "Cone Kid fell out of the world.");
    }
  }

  private buildBackground(): void {
    const { width, theme } = this.config;
    if (theme === "village") {
      this.cameras.main.setBackgroundColor(0x9ecaf0);
      this.add.rectangle(width / 2, 560, width, 350, 0x85b16f).setDepth(-20);
      for (let i = 0; i < 12; i += 1) {
        const x = 150 + i * 300;
        this.add.rectangle(x, 548, 34, 148, 0x6f4f31).setDepth(-12);
        this.add.ellipse(x, 474, 170, 124, 0x4e783f).setDepth(-13);
      }
      for (let i = 0; i < 6; i += 1) {
        const houseX = 220 + i * 280;
        this.add.rectangle(houseX, 594, 132, 96, 0xd0b795).setDepth(-8);
        this.add.triangle(houseX, 530, 0, 56, 66, 0, 132, 56, 0x8c4f32).setDepth(-9);
      }
    } else if (theme === "cave") {
      this.cameras.main.setBackgroundColor(0x1c1f2a);
      this.add.rectangle(width / 2, 560, width, 350, 0x2a2f3d).setDepth(-20);
      for (let i = 0; i < 12; i += 1) {
        const x = i * 340 + 140;
        this.add.triangle(x, 90, 0, 0, 70, 130, 140, 0, 0x2c3446).setDepth(-15);
        this.add.triangle(x + 70, 680, 0, 0, 80, -170, 160, 0, 0x2d2c35).setDepth(-15);
      }
      this.add.rectangle(width / 2, 690, width, 40, 0x582319).setDepth(-14);
    } else {
      this.cameras.main.setBackgroundColor(0xbde4ff);
      this.add.rectangle(width / 2, 560, width, 350, 0xe9f7ff).setDepth(-20);
      for (let i = 0; i < 16; i += 1) {
        this.add.ellipse(120 + i * 260, 220 + (i % 2) * 90, 220, 80, 0xffffff).setDepth(-16);
      }
      for (let i = 0; i < 8; i += 1) {
        this.add.rectangle(200 + i * 480, 660, 90, 70, 0xf4fbff).setDepth(-12);
      }
    }
  }

  private buildTerrain(): void {
    this.ground = this.physics.add.staticGroup();
    this.platforms = this.physics.add.staticGroup();
    this.hazards = this.physics.add.staticGroup();

    const groundTexture =
      this.config.theme === "village"
        ? "ground"
        : this.config.theme === "cave"
          ? "cave-ground"
          : "cloud-ground";
    const platformTexture =
      this.config.theme === "village"
        ? "platform"
        : this.config.theme === "cave"
          ? "cave-platform"
          : "cloud-platform";

    for (const segment of this.config.groundSegments) {
      const y = segment.y ?? BASE_GROUND_Y;
      for (let x = segment.x + TILE_WIDTH / 2; x < segment.x + segment.width; x += TILE_WIDTH) {
        this.ground.create(x, y, groundTexture);
      }
    }

    for (const point of this.config.platforms) {
      this.platforms.create(point.x, point.y, platformTexture);
    }

    for (const lava of this.config.lavaZones) {
      const hazard = this.hazards.create(lava.x, lava.y, "lava") as ArcadeSprite;
      hazard.setDisplaySize(lava.width, lava.height);
      hazard.setDepth(-1);
      hazard.refreshBody();
    }
  }

  private buildInteractables(): void {
    this.bearings = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const point of this.config.bearings) {
      this.spawnBearing(point.x, point.y);
    }

    this.crates = this.physics.add.group({ bounceX: 0.08, bounceY: 0.03 });
    for (const point of this.config.crates) {
      this.crates.create(point.x, point.y, "crate");
    }
  }

  private buildEnemies(): void {
    this.enemies = this.physics.add.group();

    for (const enemySpec of this.config.enemies) {
      const useLevel2Bolt =
        enemySpec.type === "bolt" &&
        this.levelNumber === 2 &&
        this.textures.exists("bolt-brute-lava");
      const texture =
        enemySpec.type === "bolt"
          ? useLevel2Bolt
            ? "bolt-brute-lava"
            : "bolt-brute"
          : "fried-chicken";
      const enemy = this.enemies.create(enemySpec.x, enemySpec.y, texture) as ArcadeSprite;
      enemy.setData("type", enemySpec.type);
      enemy.setData("hp", enemySpec.type === "bolt" ? 3 : this.levelNumber === 3 ? 3 : 2);
      enemy.setData("nextJumpAt", 0);
      enemy.setDepth(7);
      enemy.setCollideWorldBounds(true);
      if (useLevel2Bolt) {
        enemy.setDisplaySize(46, 56);
      }

      const body = enemy.body as Phaser.Physics.Arcade.Body;
      if (enemySpec.type === "bolt") {
        body.setSize(28, 40);
        body.setOffset(3, 2);
      } else {
        body.setSize(30, 28);
        body.setOffset(1, 10);
      }
    }
  }

  private buildVillagers(): void {
    this.villagers = [];
    for (const villagerSpec of this.config.villagers) {
      const villager = this.add
        .image(villagerSpec.x, villagerSpec.y, villagerSpec.texture)
        .setTint(villagerSpec.tint)
        .setDepth(6);
      villager.setData("message", villagerSpec.message);
      this.villagers.push(villager);
    }

    if (this.villagers.length > 0) {
      this.tweens.add({
        targets: this.villagers,
        y: "-=6",
        angle: { from: -6, to: 6 },
        duration: 320,
        yoyo: true,
        repeat: -1,
        stagger: 70,
      });
    }
  }

  private buildExit(): void {
    const texture = this.config.exitType === "house" ? "house-door" : "palace-door";
    this.add
      .image(this.config.exit.x, this.config.exit.y, texture)
      .setDepth(7);
  }

  private buildPlayer(): void {
    this.player = this.physics.add
      .sprite(this.config.spawn.x, this.config.spawn.y, "cone-kid")
      .setDepth(9)
      .setCollideWorldBounds(true);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(20, 42);
    body.setOffset(6, 4);
  }

  private setupCollisions(): void {
    this.physics.add.collider(this.player, this.ground);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.player, this.crates);

    this.physics.add.collider(this.crates, this.ground);
    this.physics.add.collider(this.crates, this.platforms);

    this.physics.add.collider(this.enemies, this.ground);
    this.physics.add.collider(this.enemies, this.platforms);
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.enemies, this.crates);

    this.physics.add.overlap(this.player, this.bearings, (obj1, obj2) => {
      this.onPlayerPickBearing(obj1 as ArcadeSprite, obj2 as ArcadeSprite);
    });

    this.physics.add.collider(this.player, this.enemies, (obj1, obj2) => {
      this.onPlayerTouchEnemy(obj1 as ArcadeSprite, obj2 as ArcadeSprite);
    });

    this.physics.add.collider(this.crates, this.enemies, (obj1, obj2) => {
      this.onCrateHitEnemy(obj1 as ArcadeSprite, obj2 as ArcadeSprite);
    });

    this.physics.add.overlap(this.player, this.hazards, () => {
      this.damagePlayer(MAX_HP, "Cone Kid touched lava.");
    });

    this.physics.add.overlap(this.enemies, this.hazards, (obj1) => {
      this.defeatEnemy(obj1 as ArcadeSprite, false);
    });

    this.physics.add.overlap(this.crates, this.hazards, (obj1) => {
      const crate = obj1 as ArcadeSprite;
      if (crate.active && !crate.getData("carried")) {
        crate.destroy();
      }
    });
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input unavailable.");
    }

    this.cursors = keyboard.createCursorKeys();
    this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.interactKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.restartKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.answerOneKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.answerTwoKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.answerThreeKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
  }

  private createHud(): void {
    this.hudText = this.add
      .text(14, 12, "", {
        fontFamily: "Verdana",
        fontSize: "18px",
        color: "#08131f",
        stroke: "#f3fbff",
        strokeThickness: 4,
      })
      .setScrollFactor(0)
      .setDepth(30);

    this.taskText = this.add
      .text(14, 60, "", {
        fontFamily: "Verdana",
        fontSize: "16px",
        color: "#0f1e2b",
        stroke: "#f3fbff",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(30);

    this.promptText = this.add
      .text(
        14,
        680,
        "Arrow keys move, Z punch/kick, X pick/throw crate, R restart run.",
        {
          fontFamily: "Verdana",
          fontSize: "17px",
          color: "#f7fbff",
          stroke: "#182231",
          strokeThickness: 5,
        },
      )
      .setScrollFactor(0)
      .setDepth(30);

    this.bannerText = this.add
      .text(512, 40, "", {
        fontFamily: "Verdana",
        fontSize: "32px",
        color: "#fff3cd",
        stroke: "#1f2836",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(40)
      .setScrollFactor(0)
      .setVisible(false);

    this.updateHud();
  }

  private handleMovement(time: number): void {
    if (this.transitioning) {
      this.player.setVelocityX(0);
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const onGround = body.blocked.down || body.touching.down;
    const crouching = this.cursors.down.isDown && onGround;
    if (onGround) {
      this.boosterUsedThisAir = false;
    }

    if (!this.isAttacking) {
      let velocityX = 0;
      if (!crouching && this.cursors.left.isDown) {
        velocityX = -PLAYER_SPEED;
        this.facing = -1;
        this.player.setFlipX(true);
      } else if (!crouching && this.cursors.right.isDown) {
        velocityX = PLAYER_SPEED;
        this.facing = 1;
        this.player.setFlipX(false);
      }
      this.player.setVelocityX(velocityX);
    }

    const wantsJump =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.space);
    if (wantsJump && !crouching) {
      const now = this.time.now;
      const isDoubleTap = now - this.lastJumpTapAt <= 280;
      this.lastJumpTapAt = now;

      if (onGround) {
        this.player.setVelocityY(JUMP_SPEED);
        hardRockAudio.playSfx("jump");
      }

      const canUseBooster =
        this.levelNumber === 2 && isDoubleTap && !this.boosterUsedThisAir;
      if (canUseBooster) {
        if (this.bearingsCollected >= 1) {
          this.bearingsCollected -= 1;
          this.totalBearings = Math.max(0, this.totalBearings - 1);
          this.boosterUsedThisAir = true;

          // 2x jump boost for cave parkour.
          const boostedVelocityY = Math.min(body.velocity.y, JUMP_SPEED * 2);
          this.player.setVelocityY(boostedVelocityY);
          hardRockAudio.playSfx("jump");
          this.showPrompt("Booster jump! -1 bearing.", 900);
        } else {
          this.showPrompt("Need 1 bearing for booster jump.", 900);
        }
      }
    }

    if (crouching) {
      this.player.setScale(1, 0.88);
      this.player.setVelocityX(0);
    } else {
      this.player.setScale(1);
    }

    if (Math.abs(body.velocity.x) > 16 && onGround) {
      this.player.setAngle(Math.sin(time / 72) * 3);
    } else {
      this.player.setAngle(0);
    }
  }

  private performAttack(): void {
    if (this.isAttacking || this.transitioning) {
      return;
    }

    this.isAttacking = true;
    hardRockAudio.playSfx("attack");
    this.player.setTint(0xfff0aa);

    const hitbox = this.add.zone(
      this.player.x + this.facing * 50,
      this.player.y - 2,
      74,
      46,
    );
    this.physics.add.existing(hitbox);
    const body = hitbox.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);

    this.physics.overlap(hitbox, this.enemies, (_obj1, obj2) => {
      this.damageEnemy(obj2 as ArcadeSprite, 2, this.facing);
    });

    this.time.delayedCall(110, () => {
      hitbox.destroy();
    });
    this.time.delayedCall(180, () => {
      this.isAttacking = false;
      if (this.time.now >= this.invulnerableUntil) {
        this.player.clearTint();
      } else {
        this.player.setTintFill(0xff778f);
      }
    });
  }

  private handleInteract(): void {
    if (this.transitioning) {
      return;
    }

    if (this.carryingCrate) {
      if (this.levelNumber === 2 && !this.cursors.up.isDown) {
        this.placeCarriedCrate();
      } else {
        this.throwCarriedCrate();
      }
      return;
    }

    const nearest = this.findNearestCrate();
    if (!nearest) {
      this.showPrompt("No crate nearby.", 900);
      return;
    }

    this.pickUpCrate(nearest);
  }

  private findNearestCrate(): ArcadeSprite | null {
    let nearest: ArcadeSprite | null = null;
    let bestDistance = 70;

    for (const entry of this.crates.getChildren()) {
      const crate = entry as ArcadeSprite;
      if (!crate.active || crate.getData("carried")) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        crate.x,
        crate.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = crate;
      }
    }

    return nearest;
  }

  private pickUpCrate(crate: ArcadeSprite): void {
    this.carryingCrate = crate;
    crate.setData("carried", true);
    crate.setDepth(20);
    crate.setVelocity(0, 0);
    crate.setAngularVelocity(0);

    // Disable physics body while carried to avoid movement/collision glitches.
    const body = crate.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    if (this.levelNumber === 2) {
      this.showPrompt("Carrying crate. Press X to place, or UP+X to throw.", 1400);
    } else {
      this.showPrompt("Carrying crate. Press X again to throw.", 1200);
    }
  }

  private placeCarriedCrate(): void {
    if (!this.carryingCrate) {
      return;
    }

    const crate = this.carryingCrate;
    crate.setData("carried", false);
    crate.setDepth(7);

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    const x = this.player.x + this.facing * 36;
    const y = playerBody.bottom - 15;
    crate.setPosition(x, y);
    crate.setAngle(0);

    const body = crate.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    crate.setVelocity(0, 0);
    crate.setAngularVelocity(0);

    this.carryingCrate = null;
    this.showPrompt("Crate placed.", 700);
  }

  private throwCarriedCrate(): void {
    if (!this.carryingCrate) {
      return;
    }

    const crate = this.carryingCrate;
    crate.setData("carried", false);
    crate.setDepth(7);

    const x = this.player.x + this.facing * 30;
    const y = this.player.y - 24;
    crate.setPosition(x, y);

    const body = crate.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    crate.setVelocity(this.facing * 360, -180);
    crate.setAngularVelocity(this.facing * 220);

    this.carryingCrate = null;
    hardRockAudio.playSfx("throw");
  }

  private updateCarriedCrate(): void {
    if (!this.carryingCrate || !this.carryingCrate.active) {
      return;
    }

    const x = this.player.x + this.facing * 26;
    const y = this.player.y - 34;
    this.carryingCrate.setPosition(x, y);
    this.carryingCrate.setAngle(Math.sin(this.time.now / 95) * 3);
  }

  private updateEnemyAI(time: number): void {
    for (const entry of this.enemies.getChildren()) {
      const enemy = entry as ArcadeSprite;
      if (!enemy.active) {
        continue;
      }

      const body = enemy.body as Phaser.Physics.Arcade.Body;
      const enemyType = (enemy.getData("type") as EnemyType) ?? "bolt";
      const distance = Phaser.Math.Distance.Between(
        enemy.x,
        enemy.y,
        this.player.x,
        this.player.y,
      );

      if (distance > 760) {
        enemy.setVelocityX(0);
        continue;
      }

      const direction = this.player.x > enemy.x ? 1 : -1;
      const hardHeavenChicken = enemyType === "chicken" && this.levelNumber === 3;
      const packBonus = enemyType === "bolt" ? Math.max(0, this.countNearbyEnemies(enemy, 130) - 1) : 0;
      const speed = enemyType === "bolt" ? 70 + packBonus * 24 : hardHeavenChicken ? 195 : 150;
      const sway = enemyType === "chicken"
        ? Math.sin(time / (hardHeavenChicken ? 90 : 130) + enemy.x * 0.01) * (hardHeavenChicken ? 28 : 20)
        : 0;

      enemy.setVelocityX(direction * speed + sway);
      enemy.setFlipX(direction < 0);

      const nextJumpAt = (enemy.getData("nextJumpAt") as number) ?? 0;
      const jumpRange = hardHeavenChicken ? 300 : 230;
      if (time > nextJumpAt && body.blocked.down && distance < jumpRange) {
        const jumpPower = enemyType === "bolt" ? -265 : hardHeavenChicken ? -360 : -310;
        enemy.setVelocityY(jumpPower);
        enemy.setData(
          "nextJumpAt",
          time + (enemyType === "bolt" ? 1500 : hardHeavenChicken ? 650 : 900),
        );
      }
    }
  }

  private onPlayerPickBearing(_player: ArcadeSprite, bearing: ArcadeSprite): void {
    if (!bearing.active) {
      return;
    }

    bearing.destroy();
    this.bearingsCollected += 1;
    this.totalBearings += 1;
    hardRockAudio.playSfx("collect");
  }

  private onPlayerTouchEnemy(_player: ArcadeSprite, enemy: ArcadeSprite): void {
    const enemyType = (enemy.getData("type") as EnemyType) ?? "bolt";
    const boltPack = enemyType === "bolt" ? this.countNearbyEnemies(enemy, 120) : 1;
    const damage = enemyType === "bolt" && boltPack >= 3 ? 2 : 1;
    const push = this.player.x < enemy.x ? -230 : 230;

    this.player.setVelocity(push, -210);
    enemy.setVelocity(-push * 0.4, -140);

    const reason =
      enemyType === "bolt" && boltPack >= 3
        ? "Bolt Brute pack hit hard."
        : enemyType === "bolt"
          ? "Bolt Brute landed a hit."
          : "Fried chicken swarm pecked Cone Kid.";
    this.damagePlayer(damage, reason);
  }

  private onCrateHitEnemy(crate: ArcadeSprite, enemy: ArcadeSprite): void {
    if (!crate.active || !enemy.active || crate.getData("carried")) {
      return;
    }

    const body = crate.body as Phaser.Physics.Arcade.Body;
    const impact = Math.abs(body.velocity.x) + Math.abs(body.velocity.y);
    if (impact < 150) {
      return;
    }

    const direction = body.velocity.x >= 0 ? 1 : -1;
    this.damageEnemy(enemy, 3, direction);
    if (impact > 420) {
      crate.destroy();
    }
  }

  private damageEnemy(enemy: ArcadeSprite, amount: number, knockDirection: number): void {
    if (!enemy.active) {
      return;
    }

    const hp = ((enemy.getData("hp") as number) ?? 3) - amount;
    if (hp <= 0) {
      this.defeatEnemy(enemy, true);
      return;
    }

    enemy.setData("hp", hp);
    enemy.setTintFill(0xff8888);
    enemy.setVelocity(knockDirection * 190, -180);
    hardRockAudio.playSfx("enemyHit");
    this.time.delayedCall(120, () => {
      if (enemy.active) {
        enemy.clearTint();
      }
    });
  }

  private defeatEnemy(enemy: ArcadeSprite, countForTask: boolean): void {
    if (!enemy.active) {
      return;
    }

    const x = enemy.x;
    const y = enemy.y;
    enemy.disableBody(true, true);

    if (countForTask) {
      this.enemiesDefeated += 1;
      hardRockAudio.playSfx("enemyHit");
    }

    this.spawnBearing(x, y - 14);
  }

  private damagePlayer(amount: number, reason: string): void {
    if (this.transitioning || this.gameFinished || this.gameOver) {
      return;
    }
    if (this.time.now < this.invulnerableUntil && amount < MAX_HP) {
      return;
    }

    this.hp = Math.max(0, this.hp - amount);
    this.invulnerableUntil = this.time.now + 800;
    this.player.setTintFill(0xff778f);
    this.cameras.main.shake(130, 0.004);
    hardRockAudio.playSfx("playerHit");

    this.time.delayedCall(130, () => {
      if (!this.gameOver && !this.gameFinished) {
        this.player.clearTint();
      }
    });

    if (this.hp <= 0) {
      this.loseLife(reason);
    }
  }

  private loseLife(reason: string): void {
    if (this.transitioning) {
      return;
    }

    if (this.levelNumber === 3) {
      this.startFairyRiddle(reason);
      return;
    }

    this.transitioning = true;
    this.lives -= 1;
    hardRockAudio.playSfx("lifeLost");

    if (this.lives <= 0) {
      this.gameOver = true;
      this.physics.world.pause();
      this.showBanner("Game Over");
      this.showPrompt(`${reason} No lives left. Press R to restart from Level 1.`, 999999);
      return;
    }

    this.physics.world.pause();
    this.showBanner("Life Lost");
    this.showPrompt(`${reason} ${this.lives} lives left.`, 1300);
    this.time.delayedCall(1100, () => {
      this.scene.restart({
        level: this.levelNumber,
        lives: this.lives,
        totalBearings: this.totalBearings,
      });
    });
  }

  private startFairyRiddle(reason: string): void {
    this.transitioning = true;
    this.physics.world.pause();
    hardRockAudio.playSfx("lifeLost");

    if (this.fairyOverlay) {
      this.fairyOverlay.destroy();
      this.fairyOverlay = null;
    }

    const overlay = this.add.container(0, 0).setDepth(80).setScrollFactor(0);
    const shade = this.add
      .rectangle(512, 360, 1024, 720, 0x101521, 0.72)
      .setOrigin(0.5);
    const panel = this.add
      .rectangle(512, 360, 760, 410, 0xf9f0d8, 0.96)
      .setStrokeStyle(6, 0xc59b52);
    const fairy = this.add.image(330, 335, "fairy-godmother").setScale(1.35);
    const bucket = this.add.image(388, 412, "chicken-bucket").setScale(1.1);

    const title = this.add.text(512, 218, "Fairy Godmother Appears!", {
      fontFamily: "Verdana",
      fontSize: "34px",
      color: "#452407",
      stroke: "#fff4dc",
      strokeThickness: 4,
    }).setOrigin(0.5);

    const riddle = this.add.text(
      512,
      294,
      [
        "She gives you a bucket of fried chicken and asks:",
        "\"What has keys but cannot open locks?\"",
        "",
        "1) A keyboard",
        "2) A cave door",
        "3) A treasure chest",
      ].join("\n"),
      {
        fontFamily: "Verdana",
        fontSize: "23px",
        color: "#2c2f41",
        align: "center",
        lineSpacing: 5,
      },
    ).setOrigin(0.5, 0);

    const footer = this.add.text(512, 558, "Press 1, 2, or 3 to answer.", {
      fontFamily: "Verdana",
      fontSize: "24px",
      color: "#5b2e11",
      stroke: "#fff4dc",
      strokeThickness: 4,
    }).setOrigin(0.5);

    overlay.add([shade, panel, fairy, bucket, title, riddle, footer]);
    this.fairyOverlay = overlay;
    this.fairyRiddleActive = true;

    this.showPrompt(`${reason} Fairy challenge: answer the riddle to stay in Level 3.`, 999999);
  }

  private handleFairyRiddleInput(): void {
    let answer = 0;
    if (Phaser.Input.Keyboard.JustDown(this.answerOneKey)) {
      answer = 1;
    } else if (Phaser.Input.Keyboard.JustDown(this.answerTwoKey)) {
      answer = 2;
    } else if (Phaser.Input.Keyboard.JustDown(this.answerThreeKey)) {
      answer = 3;
    }

    if (answer === 0) {
      return;
    }

    const correct = answer === 1;
    this.resolveFairyRiddle(correct);
  }

  private resolveFairyRiddle(correct: boolean): void {
    this.fairyRiddleActive = false;
    if (this.fairyOverlay) {
      this.fairyOverlay.destroy();
      this.fairyOverlay = null;
    }

    if (correct) {
      hardRockAudio.playSfx("levelClear");
      this.showBanner("Correct! Fairy Blessing");
      this.showPrompt("You stay in Level 3. The fairy revives Cone Kid.", 1300);
      this.time.delayedCall(1050, () => {
        this.scene.restart({
          level: 3,
          lives: this.lives,
          totalBearings: this.totalBearings,
        });
      });
      return;
    }

    this.showBanner("Wrong Riddle Answer");
    this.showPrompt("Wrong answer. Back to Level 1 as usual...", 1300);
    this.time.delayedCall(1100, () => {
      this.scene.restart({
        level: 1,
        lives: MAX_LIVES,
        totalBearings: 0,
      });
    });
  }

  private checkExit(): void {
    if (this.transitioning || this.gameOver || this.gameFinished) {
      return;
    }

    const closeOnX = Math.abs(this.player.x - this.config.exit.x) <= 120;
    const closeOnY = Math.abs(this.player.y - this.config.exit.y) <= 140;
    if (!closeOnX || !closeOnY) {
      return;
    }

    const enterLabel =
      this.config.exitType === "house"
        ? "Hold UP (or press X) to enter the house."
        : "Hold UP (or press X) to enter the palace.";
    this.showPrompt(enterLabel, 700);

    const wantsEnter =
      this.cursors.up.isDown || Phaser.Input.Keyboard.JustDown(this.interactKey);
    if (!wantsEnter) {
      return;
    }

    if (!this.objectivesMet()) {
      this.showPrompt(this.missingObjectiveText(), 900);
      return;
    }

    this.transitioning = true;
    this.physics.world.pause();
    hardRockAudio.playSfx(this.levelNumber === 3 ? "win" : "levelClear");

    if (this.levelNumber < 3) {
      this.showBanner(`Level ${this.levelNumber} Complete`);
      this.showPrompt(`Moving to Level ${this.levelNumber + 1}...`, 1200);
      this.time.delayedCall(1000, () => {
        this.scene.restart({
          level: (this.levelNumber + 1) as 2 | 3,
          lives: this.lives,
          totalBearings: this.totalBearings,
        });
      });
      return;
    }

    this.gameFinished = true;
    this.showBanner("You Reached The Palace!");
    this.showPrompt(
      `SKF Cone Kid Game complete with ${this.lives} lives left. Press R to play again.`,
      999999,
    );
  }

  private updateAmbientPrompt(): void {
    if (this.time.now < this.promptLockUntil) {
      return;
    }

    for (const villager of this.villagers) {
      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        villager.x,
        villager.y,
      );
      if (distance < 120) {
        const message = (villager.getData("message") as string) ?? "Keep going!";
        this.promptText.setText(`Villager: ${message}`);
        return;
      }
    }

    this.promptText.setText(
      "Arrow keys move, Z punch/kick, X pick/throw crate, R restart run.",
    );
  }

  private showPrompt(message: string, holdMs: number): void {
    this.promptText.setText(message);
    this.promptLockUntil = this.time.now + holdMs;
  }

  private showBanner(message: string): void {
    this.bannerText.setText(message);
    this.bannerText.setVisible(true);
    this.time.delayedCall(1600, () => {
      if (!this.gameOver && !this.gameFinished) {
        this.bannerText.setVisible(false);
      }
    });
  }

  private updateHud(): void {
    this.hudText.setText(
      `Level ${this.levelNumber}/3  Lives: ${this.lives}  HP: ${this.hp}/${MAX_HP}  Bearings: ${this.bearingsCollected}/${this.config.requiredBearings}  Defeated: ${this.enemiesDefeated}/${this.config.requiredDefeats}  Total Bearings: ${this.totalBearings}`,
    );

    const collectDone = this.bearingsCollected >= this.config.requiredBearings;
    const defeatDone = this.enemiesDefeated >= this.config.requiredDefeats;
    this.taskText.setText(
      [
        "Tasks:",
        `${collectDone ? "[x]" : "[ ]"} Collect ${this.config.requiredBearings} bearings`,
        `${defeatDone ? "[x]" : "[ ]"} Defeat ${this.config.requiredDefeats} enemies`,
        `${this.objectivesMet() ? "[x]" : "[ ]"} Reach the ${this.config.exitType}`,
      ].join("\n"),
    );
  }

  private objectivesMet(): boolean {
    return (
      this.bearingsCollected >= this.config.requiredBearings &&
      this.enemiesDefeated >= this.config.requiredDefeats
    );
  }

  private missingObjectiveText(): string {
    const needBearings = Math.max(0, this.config.requiredBearings - this.bearingsCollected);
    const needDefeats = Math.max(0, this.config.requiredDefeats - this.enemiesDefeated);

    const parts: string[] = [];
    if (needBearings > 0) {
      parts.push(`collect ${needBearings} more bearings`);
    }
    if (needDefeats > 0) {
      parts.push(`defeat ${needDefeats} more enemies`);
    }
    return `Complete tasks before entering: ${parts.join(" and ")}.`;
  }

  private countNearbyEnemies(origin: ArcadeSprite, radius: number): number {
    let count = 0;
    for (const entry of this.enemies.getChildren()) {
      const enemy = entry as ArcadeSprite;
      if (!enemy.active) {
        continue;
      }
      const distance = Phaser.Math.Distance.Between(origin.x, origin.y, enemy.x, enemy.y);
      if (distance <= radius) {
        count += 1;
      }
    }
    return count;
  }

  private spawnBearing(x: number, y: number): void {
    const bearing = this.bearings.create(x, y, "bearing") as ArcadeSprite;
    const body = bearing.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setCircle(7, 1, 1);
  }

  private levelIntroText(): string {
    if (this.levelNumber === 1) {
      return "Level 1: Medieval Village. Villagers have tasks for you.";
    }
    if (this.levelNumber === 2) {
      return "Level 2: Cave Parkour. Avoid lava, double-tap jump for booster (-1 bearing), and reach the house.";
    }
    return "Level 3: Heaven. Defeat fried chicken attackers and reach the palace.";
  }

  private getLevelConfig(level: 1 | 2 | 3): LevelConfig {
    if (level === 1) {
      return {
        number: 1,
        name: "Village",
        theme: "village",
        width: 3800,
        spawn: { x: 120, y: 620 },
        requiredBearings: 8,
        requiredDefeats: 6,
        groundSegments: [{ x: 0, width: 3900 }],
        platforms: [
          { x: 820, y: 610 },
          { x: 980, y: 560 },
          { x: 1220, y: 590 },
          { x: 1710, y: 560 },
          { x: 2120, y: 595 },
          { x: 2600, y: 560 },
          { x: 3050, y: 610 },
          { x: 3420, y: 560 },
        ],
        bearings: [
          { x: 610, y: 630 },
          { x: 900, y: 530 },
          { x: 1130, y: 500 },
          { x: 1400, y: 630 },
          { x: 1690, y: 520 },
          { x: 1970, y: 625 },
          { x: 2260, y: 545 },
          { x: 2550, y: 625 },
          { x: 2840, y: 525 },
          { x: 3090, y: 615 },
          { x: 3380, y: 620 },
        ],
        crates: [
          { x: 700, y: 620 },
          { x: 1450, y: 620 },
          { x: 2030, y: 620 },
          { x: 2660, y: 620 },
          { x: 3250, y: 620 },
        ],
        enemies: [
          { x: 980, y: 620, type: "bolt" },
          { x: 1120, y: 620, type: "bolt" },
          { x: 1450, y: 620, type: "bolt" },
          { x: 1940, y: 620, type: "bolt" },
          { x: 2120, y: 620, type: "bolt" },
          { x: 2250, y: 620, type: "bolt" },
          { x: 2720, y: 620, type: "bolt" },
          { x: 2950, y: 620, type: "bolt" },
          { x: 3140, y: 620, type: "bolt" },
        ],
        villagers: [
          {
            x: 250,
            y: 620,
            texture: "villager-girl",
            tint: 0xd96ad7,
            message: "Task one: collect 8 bearings for the village machines.",
          },
          {
            x: 320,
            y: 620,
            texture: "villager-boy",
            tint: 0x6f8dff,
            message: "Task two: defeat 6 Bolt Brutes.",
          },
          {
            x: 390,
            y: 620,
            texture: "villager-girl",
            tint: 0x57cf8f,
            message: "Final task: enter the house at the east end.",
          },
          {
            x: 460,
            y: 620,
            texture: "villager-boy",
            tint: 0xffb85c,
            message: "Crates can crush enemies. Use X to throw.",
          },
          {
            x: 530,
            y: 620,
            texture: "villager-girl",
            tint: 0x74d8ff,
            message: "We dance for luck. You fight for bearings!",
          },
          {
            x: 600,
            y: 620,
            texture: "villager-boy",
            tint: 0xff7d9f,
            message: "Groups of Bolt Brutes are dangerous.",
          },
        ],
        lavaZones: [],
        exit: { x: 3630, y: 595 },
        exitType: "house",
      };
    }

    if (level === 2) {
      return {
        number: 2,
        name: "Cave",
        theme: "cave",
        width: 4050,
        spawn: { x: 120, y: 620 },
        requiredBearings: 8,
        requiredDefeats: 6,
        groundSegments: [
          { x: 0, width: 520 },
          { x: 980, width: 420 },
          { x: 1730, width: 360 },
          { x: 2460, width: 410 },
          { x: 3290, width: 760 },
        ],
        platforms: [
          { x: 650, y: 595 },
          { x: 780, y: 540 },
          { x: 1140, y: 575 },
          { x: 1460, y: 525 },
          { x: 1910, y: 585 },
          { x: 2190, y: 525 },
          { x: 2640, y: 585 },
          { x: 2940, y: 525 },
          { x: 3470, y: 585 },
          { x: 3720, y: 540 },
        ],
        bearings: [
          { x: 400, y: 620 },
          { x: 760, y: 470 },
          { x: 1130, y: 510 },
          { x: 1470, y: 450 },
          { x: 1880, y: 520 },
          { x: 2210, y: 450 },
          { x: 2660, y: 520 },
          { x: 2950, y: 450 },
          { x: 3510, y: 520 },
          { x: 3790, y: 470 },
          { x: 3660, y: 620 },
          { x: 3810, y: 620 },
          { x: 3920, y: 620 },
        ],
        crates: [
          { x: 280, y: 620 },
          { x: 1090, y: 620 },
          { x: 1810, y: 620 },
          { x: 2550, y: 620 },
          { x: 3380, y: 620 },
        ],
        enemies: [
          { x: 360, y: 620, type: "bolt" },
          { x: 440, y: 620, type: "bolt" },
          { x: 1020, y: 620, type: "bolt" },
          { x: 1170, y: 620, type: "bolt" },
          { x: 1310, y: 620, type: "bolt" },
          { x: 1810, y: 620, type: "bolt" },
          { x: 1900, y: 620, type: "bolt" },
          { x: 2010, y: 620, type: "bolt" },
          { x: 2580, y: 620, type: "bolt" },
          { x: 2680, y: 620, type: "bolt" },
          { x: 2770, y: 620, type: "bolt" },
          { x: 3400, y: 620, type: "bolt" },
          { x: 3520, y: 620, type: "bolt" },
          { x: 3610, y: 620, type: "bolt" },
          { x: 3740, y: 620, type: "bolt" },
          { x: 3860, y: 620, type: "bolt" },
          { x: 3970, y: 620, type: "bolt" },
        ],
        villagers: [
          {
            x: 220,
            y: 620,
            texture: "villager-boy",
            tint: 0xa7a7b2,
            message: "Cave task: parkour over lava. Double-tap jump for booster (-1 bearing).",
          },
        ],
        lavaZones: [
          { x: 740, y: 694, width: 420, height: 52 },
          { x: 1530, y: 694, width: 340, height: 52 },
          { x: 2260, y: 694, width: 340, height: 52 },
          { x: 3070, y: 694, width: 360, height: 52 },
        ],
        exit: { x: 3900, y: 595 },
        exitType: "house",
      };
    }

    return {
      number: 3,
      name: "Heaven",
      theme: "heaven",
      width: 4100,
      spawn: { x: 120, y: 620 },
      requiredBearings: 13,
      requiredDefeats: 10,
      groundSegments: [{ x: 0, width: 4200 }],
      platforms: [
        { x: 760, y: 560 },
        { x: 980, y: 510 },
        { x: 1280, y: 560 },
        { x: 1600, y: 510 },
        { x: 1930, y: 560 },
        { x: 2260, y: 510 },
        { x: 2590, y: 560 },
        { x: 2920, y: 510 },
        { x: 3260, y: 560 },
        { x: 3600, y: 510 },
      ],
      bearings: [
        { x: 480, y: 630 },
        { x: 760, y: 530 },
        { x: 980, y: 480 },
        { x: 1280, y: 530 },
        { x: 1600, y: 480 },
        { x: 1930, y: 530 },
        { x: 2260, y: 480 },
        { x: 2590, y: 530 },
        { x: 2920, y: 480 },
        { x: 3260, y: 530 },
        { x: 3640, y: 480 },
      ],
      crates: [
        { x: 520, y: 620 },
        { x: 1160, y: 620 },
        { x: 2450, y: 620 },
        { x: 3340, y: 620 },
      ],
      enemies: [
        { x: 760, y: 620, type: "chicken" },
        { x: 980, y: 620, type: "chicken" },
        { x: 1180, y: 620, type: "chicken" },
        { x: 1450, y: 620, type: "chicken" },
        { x: 1680, y: 620, type: "chicken" },
        { x: 1870, y: 620, type: "chicken" },
        { x: 2040, y: 620, type: "chicken" },
        { x: 2150, y: 620, type: "chicken" },
        { x: 2400, y: 620, type: "chicken" },
        { x: 2630, y: 620, type: "chicken" },
        { x: 2870, y: 620, type: "chicken" },
        { x: 3120, y: 620, type: "chicken" },
        { x: 3330, y: 620, type: "chicken" },
        { x: 3470, y: 620, type: "chicken" },
        { x: 3650, y: 620, type: "chicken" },
        { x: 3810, y: 620, type: "chicken" },
      ],
      villagers: [
        {
          x: 280,
          y: 620,
          texture: "villager-girl",
          tint: 0xffef9a,
          message: "Last task board: collect 13 bearings and defeat 10 chickens.",
        },
        {
          x: 360,
          y: 620,
          texture: "villager-boy",
          tint: 0x9ce8ff,
          message: "After that, enter the palace to finish the game.",
        },
      ],
      lavaZones: [],
      exit: { x: 3930, y: 592 },
      exitType: "palace",
    };
  }

  private createRuntimeTextures(): void {
    if (this.textures.exists("cone-kid")) {
      return;
    }

    const graphics = this.add.graphics();
    graphics.setVisible(false);

    graphics.clear();
    graphics.fillStyle(0xf4c99e, 1);
    graphics.fillCircle(16, 12, 8);
    graphics.fillStyle(0xff982f, 1);
    graphics.fillTriangle(16, 0, 5, 16, 27, 16);
    graphics.fillStyle(0x2f64d8, 1);
    graphics.fillRoundedRect(8, 20, 16, 16, 3);
    graphics.fillStyle(0x111111, 1);
    graphics.fillRect(8, 36, 6, 12);
    graphics.fillRect(18, 36, 6, 12);
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(11, 11, 2, 2);
    graphics.fillRect(19, 11, 2, 2);
    graphics.generateTexture("cone-kid", 32, 48);

    graphics.clear();
    graphics.fillStyle(0xf2c89e, 1);
    graphics.fillCircle(14, 12, 8);
    graphics.fillStyle(0x3f64e1, 1);
    graphics.fillTriangle(14, 0, 5, 15, 23, 15);
    graphics.fillRoundedRect(5, 20, 18, 14, 3);
    graphics.fillStyle(0x111111, 1);
    graphics.fillRect(6, 34, 6, 10);
    graphics.fillRect(16, 34, 6, 10);
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(10, 11, 2, 2);
    graphics.fillRect(17, 11, 2, 2);
    graphics.generateTexture("villager-boy", 28, 44);

    graphics.clear();
    graphics.fillStyle(0xf2c89e, 1);
    graphics.fillCircle(14, 12, 8);
    graphics.fillStyle(0xb34cb2, 1);
    graphics.fillTriangle(14, 0, 5, 15, 23, 15);
    graphics.fillRoundedRect(5, 20, 18, 14, 3);
    graphics.fillStyle(0x111111, 1);
    graphics.fillRect(6, 34, 6, 10);
    graphics.fillRect(16, 34, 6, 10);
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(10, 11, 2, 2);
    graphics.fillRect(17, 11, 2, 2);
    graphics.generateTexture("villager-girl", 28, 44);

    graphics.clear();
    graphics.fillStyle(0xa81624, 1);
    graphics.fillRoundedRect(0, 0, 34, 42, 6);
    graphics.fillStyle(0x78131c, 1);
    graphics.fillRoundedRect(8, 8, 18, 14, 4);
    graphics.fillStyle(0x2b2b2b, 1);
    graphics.fillCircle(7, 8, 2);
    graphics.fillCircle(27, 8, 2);
    graphics.fillCircle(9, 35, 3);
    graphics.fillCircle(25, 35, 3);
    graphics.fillCircle(17, 4, 2);
    graphics.generateTexture("bolt-brute", 34, 42);

    graphics.clear();
    graphics.fillStyle(0xb67a33, 1);
    graphics.fillEllipse(18, 22, 30, 24);
    graphics.fillStyle(0xe3b15f, 1);
    graphics.fillEllipse(18, 18, 24, 16);
    graphics.fillStyle(0x7b4f21, 1);
    graphics.fillRect(5, 28, 8, 10);
    graphics.fillRect(23, 28, 8, 10);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(11, 15, 2, 2);
    graphics.fillRect(21, 15, 2, 2);
    graphics.generateTexture("fried-chicken", 36, 40);

    graphics.clear();
    graphics.fillStyle(0x2d2f35, 1);
    graphics.fillCircle(8, 8, 7);
    graphics.fillStyle(0xa7b0be, 1);
    graphics.fillCircle(8, 8, 4);
    graphics.generateTexture("bearing", 16, 16);

    graphics.clear();
    graphics.fillStyle(0x886441, 1);
    graphics.fillRect(0, 0, 36, 30);
    graphics.lineStyle(2, 0xae865b, 1);
    graphics.strokeRect(1, 1, 34, 28);
    graphics.lineBetween(0, 0, 36, 30);
    graphics.lineBetween(36, 0, 0, 30);
    graphics.generateTexture("crate", 36, 30);

    graphics.clear();
    graphics.fillStyle(0x6f9650, 1);
    graphics.fillRect(0, 0, 64, 12);
    graphics.fillStyle(0x8b5d34, 1);
    graphics.fillRect(0, 12, 64, 36);
    graphics.lineStyle(2, 0x754621, 1);
    graphics.strokeRect(0, 0, 64, 48);
    graphics.generateTexture("ground", 64, 48);

    graphics.clear();
    graphics.fillStyle(0x4f5868, 1);
    graphics.fillRect(0, 0, 64, 12);
    graphics.fillStyle(0x2e313c, 1);
    graphics.fillRect(0, 12, 64, 36);
    graphics.lineStyle(2, 0x1f222d, 1);
    graphics.strokeRect(0, 0, 64, 48);
    graphics.generateTexture("cave-ground", 64, 48);

    graphics.clear();
    graphics.fillStyle(0xf8fdff, 1);
    graphics.fillRect(0, 0, 64, 12);
    graphics.fillStyle(0xdcecf5, 1);
    graphics.fillRect(0, 12, 64, 36);
    graphics.lineStyle(2, 0xc9e2f0, 1);
    graphics.strokeRect(0, 0, 64, 48);
    graphics.generateTexture("cloud-ground", 64, 48);

    graphics.clear();
    graphics.fillStyle(0x6f9650, 1);
    graphics.fillRect(0, 0, 96, 8);
    graphics.fillStyle(0x8b5d34, 1);
    graphics.fillRect(0, 8, 96, 14);
    graphics.lineStyle(2, 0x754621, 1);
    graphics.strokeRect(0, 0, 96, 22);
    graphics.generateTexture("platform", 96, 22);

    graphics.clear();
    graphics.fillStyle(0x565d6e, 1);
    graphics.fillRect(0, 0, 96, 8);
    graphics.fillStyle(0x323745, 1);
    graphics.fillRect(0, 8, 96, 14);
    graphics.lineStyle(2, 0x1f2230, 1);
    graphics.strokeRect(0, 0, 96, 22);
    graphics.generateTexture("cave-platform", 96, 22);

    graphics.clear();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(0, 0, 96, 8);
    graphics.fillStyle(0xe7f5ff, 1);
    graphics.fillRect(0, 8, 96, 14);
    graphics.lineStyle(2, 0xc5e6fa, 1);
    graphics.strokeRect(0, 0, 96, 22);
    graphics.generateTexture("cloud-platform", 96, 22);

    graphics.clear();
    graphics.fillStyle(0xb9885e, 1);
    graphics.fillRoundedRect(0, 14, 76, 96, 4);
    graphics.fillStyle(0x8b5232, 1);
    graphics.fillTriangle(38, 0, 0, 28, 76, 28);
    graphics.fillStyle(0x5b3a24, 1);
    graphics.fillRect(24, 56, 28, 54);
    graphics.generateTexture("house-door", 76, 110);

    graphics.clear();
    graphics.fillStyle(0xf5f8ff, 1);
    graphics.fillRoundedRect(0, 16, 120, 124, 6);
    graphics.fillStyle(0xd9e6ff, 1);
    graphics.fillRoundedRect(12, 0, 96, 34, 8);
    graphics.fillStyle(0xa7bbe8, 1);
    graphics.fillRect(45, 70, 30, 70);
    graphics.generateTexture("palace-door", 120, 140);

    graphics.clear();
    graphics.fillStyle(0xc94722, 1);
    graphics.fillRect(0, 0, 120, 20);
    graphics.fillStyle(0xe57f2d, 1);
    graphics.fillRect(0, 20, 120, 12);
    graphics.generateTexture("lava", 120, 32);

    graphics.clear();
    graphics.fillStyle(0xf3d2bc, 1);
    graphics.fillCircle(24, 16, 9);
    graphics.fillStyle(0xf4e4ff, 1);
    graphics.fillTriangle(24, 2, 12, 22, 36, 22);
    graphics.fillStyle(0xad7ee0, 1);
    graphics.fillRoundedRect(13, 24, 22, 20, 4);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillEllipse(7, 24, 10, 18);
    graphics.fillEllipse(41, 24, 10, 18);
    graphics.fillStyle(0x111111, 1);
    graphics.fillRect(17, 44, 6, 10);
    graphics.fillRect(25, 44, 6, 10);
    graphics.generateTexture("fairy-godmother", 48, 56);

    graphics.clear();
    graphics.fillStyle(0xcf2f2f, 1);
    graphics.fillRoundedRect(2, 18, 44, 28, 4);
    graphics.fillStyle(0xf1f1f1, 1);
    graphics.fillRect(2, 28, 44, 6);
    graphics.fillStyle(0xe0a545, 1);
    graphics.fillEllipse(10, 16, 12, 10);
    graphics.fillEllipse(20, 13, 12, 10);
    graphics.fillEllipse(30, 16, 12, 10);
    graphics.fillEllipse(39, 14, 12, 10);
    graphics.generateTexture("chicken-bucket", 48, 48);

    graphics.destroy();
  }
}
