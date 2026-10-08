#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "../src/animation/AnimationPlayer.h"
#include "../src/input/DebouncedButton.h"

using tamassol::AnimationId;
using tamassol::AnimationPlayer;
using tamassol::DebouncedButton;

static void testTransitions() {
  AnimationId id = AnimationId::Sleep;
  id = tamassol::nextAnimation(id);
  assert(id == AnimationId::Happy);
  id = tamassol::nextAnimation(id);
  assert(id == AnimationId::Angry);
  id = tamassol::nextAnimation(id);
  assert(id == AnimationId::Sleep);
  assert(tamassol::previousAnimation(id) == AnimationId::Angry);
  assert(tamassol::previousAnimation(AnimationId::Happy) == AnimationId::Sleep);
  assert(tamassol::previousAnimation(AnimationId::Angry) == AnimationId::Happy);
  assert(strcmp(tamassol::animationLabel(AnimationId::Angry), "ANGRY") == 0);
}

static void testAnimationTiming() {
  AnimationPlayer player;
  player.start(AnimationId::Sleep, 3, 250, 100);
  assert(player.frame() == 0);
  assert(!player.update(349));
  assert(player.update(350));
  assert(player.frame() == 1);
  // A late caller catches up in one call, preserving the 250 ms phase.
  assert(player.update(1625));
  assert(player.frame() == 0);
  assert(!player.update(1849));
  assert(player.update(1850));
  assert(player.frame() == 1);
  player.start(AnimationId::Happy, 2, 125, 1900);
  assert(player.animation() == AnimationId::Happy);
  assert(player.frame() == 0);
  assert(!player.update(2024));
  assert(player.update(2025));
  assert(player.frame() == 1);
  player.start(AnimationId::Happy, 2, 125, 2030);
  assert(player.frame() == 0);
  assert(!player.update(2154));
  assert(player.update(2155));
  assert(player.frame() == 1);
}

static void testAnimationRolloverAndDefensiveInput() {
  AnimationPlayer player;
  player.start(AnimationId::Angry, 3, 20, UINT32_MAX - 10);
  assert(!player.update(8));
  assert(player.update(9));
  assert(player.frame() == 1);
  assert(player.update(49));
  assert(player.frame() == 0);
  assert(!player.update(50));
  player.start(AnimationId::Sleep, 0, 0, 0);
  assert(!player.update(0));
  assert(player.update(1));
  assert(player.frame() == 0);
  // Very long stalls must remain bounded and avoid index arithmetic overflow.
  player.start(AnimationId::Happy, 65535, 1, 0);
  assert(player.update(65534));
  assert(player.frame() == 65534);
  assert(player.update(65533));  // UINT32_MAX elapsed, one rollover.
  assert(player.frame() == 65534);
}

static void testButtonBounceAndHeldPress() {
  DebouncedButton button;
  button.begin(false, 0);
  assert(!button.update(true, 10));
  assert(!button.update(false, 15));
  assert(!button.update(true, 20));
  assert(!button.update(true, 49));
  assert(button.update(true, 50));
  assert(!button.update(true, 3000));
  assert(!button.update(false, 3010));
  assert(!button.update(true, 3020));
  assert(!button.update(true, 3100));
  assert(!button.update(false, 3200));
  assert(!button.update(false, 3230));
  assert(!button.update(true, 3300));
  assert(button.update(true, 3330));

  button.begin(true, 4000);
  assert(!button.update(true, 4100));
  assert(!button.update(false, 4200));
  assert(!button.update(false, 4230));
  assert(!button.update(true, 4300));
  assert(button.update(true, 4330));
}

static void testButtonRolloverAndInitialization() {
  DebouncedButton button;
  assert(!button.update(true, 0));  // Safe implicit initialization.
  assert(!button.update(true, 100));
  button.begin(false, UINT32_MAX - 20);
  assert(!button.update(true, UINT32_MAX - 10));
  assert(!button.update(true, 18));
  assert(button.update(true, 19));
  assert(!button.update(true, 20));
}

int main() {
  testTransitions();
  testAnimationTiming();
  testAnimationRolloverAndDefensiveInput();
  testButtonBounceAndHeldPress();
  testButtonRolloverAndInitialization();
  puts("PASS: animation sequencing/timing/rollover and button debounce/boot hold");
  return 0;
}
