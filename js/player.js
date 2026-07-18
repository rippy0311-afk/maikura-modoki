'use strict';

// 一人称プレイヤー(物理・当たり判定)
class Player {
  constructor() {
    this.pos = { x: 0, y: 40, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;      // 左右
    this.pitch = 0;    // 上下
    this.onGround = false;
    this.fly = false;
    this.landedFallSpeed = 0;

    this.halfW = 0.3;
    this.height = 1.8;
    this.eye = 1.62;

    this.walkSpeed = 5.5;
    this.sprintSpeed = 8.5;
    this.flySpeed = 16;
    this.jumpVel = 8.4;
    this.gravity = 26;
  }

  eyePos() {
    return { x: this.pos.x, y: this.pos.y + this.eye, z: this.pos.z };
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp,
    };
  }

  // 体のどこかが水中か
  inWater(world) {
    const b = world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.9), Math.floor(this.pos.z));
    return b === BLOCK.WATER;
  }

  spawn(world) {
    const sp = world.spawnPoint;
    let x = sp ? sp.x : Math.floor(world.sx / 2);
    let z = sp ? sp.z : Math.floor(world.sz / 2);
    let h = world.solidHeightAt(Math.floor(x), Math.floor(z));
    let foundSafeSpawn = false;
    for (let r = 0; r <= 72 && !foundSafeSpawn; r++) {
      for (let dz = -r; dz <= r && !foundSafeSpawn; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const sx = Math.floor(x + dx);
          const sz = Math.floor(z + dz);
          if (!world.inBounds(sx, 0, sz)) continue;
          const sy = world.solidHeightAt(sx, sz);
          const feet = world.get(sx, sy + 1, sz);
          const head = world.get(sx, sy + 2, sz);
          if (feet !== BLOCK.AIR || head !== BLOCK.AIR) continue;
          x = sx;
          z = sz;
          h = sy;
          foundSafeSpawn = true;
          break;
        }
      }
    }
    this.pos = { x: x + 0.5, y: h + 2, z: z + 0.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = (sp && sp.yaw !== undefined) ? sp.yaw : Math.PI * 0.25;
    this.pitch = (sp && sp.pitch !== undefined) ? sp.pitch : -0.15;
  }

  update(dt, keys, world, moveInput = null, bindings = null) {
    dt = Math.min(dt, 0.05);
    const swimming = this.inWater(world);
    const bind = bindings || {
      forward: 'KeyW',
      back: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      jump: 'Space',
      ascend: 'Space',
      sprint: 'ShiftLeft',
      descend: 'ShiftLeft',
    };

    // 入力 → 移動方向(水平)
    let mx = 0, mz = 0;
    if (keys.has(bind.forward)) mz -= 1;
    if (keys.has(bind.back)) mz += 1;
    if (keys.has(bind.left)) mx -= 1;
    if (keys.has(bind.right)) mx += 1;
    if (moveInput) {
      mx += moveInput.x;
      mz += moveInput.z;
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    // ローカル移動ベクトルを yaw で回転(カメラ前方 = (-sin, -cos) と一致させる)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;

    // 歩行時の左Shiftはダッシュ(飛行時は下降に使う)
    const speed = this.fly ? this.flySpeed
      : keys.has(bind.sprint) ? this.sprintSpeed
      : this.walkSpeed;

    // 水平速度は即応(マイクラ風: 地上はキビキビ、空中は弱め)
    const accel = this.fly ? 20 : this.onGround ? 32 : 8;
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, accel * dt);

    if (this.fly) {
      let vy = 0;
      if (keys.has(bind.ascend)) vy += this.flySpeed;
      if (keys.has(bind.descend)) vy -= this.flySpeed;
      this.vel.y += (vy - this.vel.y) * Math.min(1, 20 * dt);
    } else if (swimming) {
      this.vel.y -= 8 * dt;
      if (keys.has(bind.ascend)) this.vel.y = 4.5;
      this.vel.y = Math.max(this.vel.y, -4);
      this.vel.x *= 0.85; this.vel.z *= 0.85;
    } else {
      this.vel.y -= this.gravity * dt;
      if (keys.has(bind.jump) && this.onGround) {
        this.vel.y = this.jumpVel;
        this.onGround = false;
      }
    }

    const fallSpeed = Math.max(0, -this.vel.y);

    // 軸ごとに移動して衝突解決
    this.onGround = false;
    this.landedFallSpeed = 0;
    this.moveAxis(world, 'x', this.vel.x * dt);
    this.moveAxis(world, 'z', this.vel.z * dt);
    this.moveAxis(world, 'y', this.vel.y * dt);
    if (this.onGround && fallSpeed > 0) this.landedFallSpeed = fallSpeed;

    // 奈落に落ちたら復帰
    if (this.pos.y < -20) this.spawn(world);
  }

  collides(world) {
    const p = this.pos;
    const x0 = Math.floor(p.x - this.halfW), x1 = Math.floor(p.x + this.halfW);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + this.height);
    const z0 = Math.floor(p.z - this.halfW), z1 = Math.floor(p.z + this.halfW);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const b = world.get(x, y, z);
          if (b !== BLOCK.AIR && b !== BLOCK.WATER) return true;
        }
      }
    }
    return false;
  }

  moveAxis(world, axis, delta) {
    if (delta === 0) return;
    this.pos[axis] += delta;
    if (!this.collides(world)) return;

    const eps = 0.001;
    if (axis === 'y') {
      if (delta < 0) {
        this.pos.y = Math.floor(this.pos.y) + 1 + eps;
        this.onGround = true;
      } else {
        this.pos.y = Math.floor(this.pos.y + this.height) - this.height - eps;
      }
      this.vel.y = 0;
    } else {
      const half = this.halfW;
      if (delta > 0) {
        this.pos[axis] = Math.floor(this.pos[axis] + half) - half - eps;
      } else {
        this.pos[axis] = Math.floor(this.pos[axis] - half) + 1 + half + eps;
      }
      this.vel[axis] = 0;
    }
  }

  // 設置しようとするブロックが体と重ならないか
  intersectsBlock(bx, by, bz) {
    const p = this.pos;
    return (
      bx + 1 > p.x - this.halfW && bx < p.x + this.halfW &&
      bz + 1 > p.z - this.halfW && bz < p.z + this.halfW &&
      by + 1 > p.y && by < p.y + this.height
    );
  }
}
