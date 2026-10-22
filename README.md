# Aquatic RSI world model

A small, live lagoon world in the browser where rays learn to forage by trial and error while you watch,
and where you can change the world under them. It runs publicly as **Ocean Shallows**:
<https://www.jiajunfan.com/lab/shallows/>.

The code in `web/` is the same code the site serves. There is no build step and no server-side part.

## The world

- **Creatures.** Manta rays and eagle rays swim in deeper water, stingrays keep to the sandy shallows (and
  sometimes settle on the sand), moon jellies and sea nettles drift with the water.
- **Food.** Plankton blooms appear on their own and wherever you tap. Each bloom spreads a scent field that a
  ray can sense on its left and right.
- **Danger.** Sea nettles sting rays that swim into the zone behind their bells.
- **Weather.** Calm, rain (blooms come faster and the scent gets noisy), a current, and a whirlpool.

## How the rays improve themselves

Each generation is one loop, and it runs about every 1.5 s of lagoon time:

1. **Copy** the lagoon. The copy is an exact world model: the same water, plankton and nettles.
2. **Imagine** 16 practice swims per ray species in the copy, each with a slightly changed habit.
3. **Keep** the changes that ate more plankton and took fewer stings.
4. **Act** with the new habit in the real lagoon, which keeps changing as you tap and switch the weather.

With the learning panel open, the page draws each generation's imagined swims on the water (brighter = scored
better) and charts learned vs untrained over generations.

## How the rays learn (details)

Each ray species shares one habit: twelve numbers that map six things a ray senses (scent left vs right, food
under its mouth, nettles left vs right, the current, the edge of its water, a constant) to how hard it turns
and how fast it swims. Two of those numbers are learned: how strongly to follow the scent and how strongly to
steer clear of nettles. The rest stay at zero.

About every 1.5 s of lagoon time, the trainer copies the current lagoon and runs 16 practice swims per species
in the copy (8 mirrored pairs of 12 s, evolution strategies with centred ranks and Adam). The habit moves
toward the swims that scored better. A swim's score is the plankton it ate, minus 2 per second spent being
stung, minus a small swimming effort, minus 1 per second spent at the very edge of its water. Nothing is
pre-trained: every page load starts from zero.

**Checked, not assumed.** The page keeps measuring the learned habit against an untrained one: both swim the
same copied lagoon from the same starts with the same noise, and the learning panel shows the plankton ratio.
`tests/learning.mjs` runs the same comparison offline. Over 5 lagoons, with and without taps, and all three
ray species (30 cases), the learned habit ate 1.02 to 1.97 times as much plankton as the untrained one after
60 generations.

## Things you can do

- Tap the water to scatter plankton; move the pointer across it to stir ripples.
- Tap a creature to startle it (rays dart away, a resting stingray lifts off the sand, jellies jet away);
  drag a creature to lead it.
- Tap a species in the toolbar to add one, drag its icon onto the water to place it, hold it to remove one.
- Switch the weather, open the learning panel, turn on sound, hide the controls, pause.
- Keys: 1-5 add a species (Shift removes), C / R / U / W weather, S sound, L learning panel, H hide, Space pause.

With reduced motion turned on the lagoon starts still and is drawn only when something changes.

## Run it

```bash
cd web && python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Add `?seed=7` for a repeatable lagoon, or `?fast` to train as fast as the
frame budget allows. Three.js 0.160.0 is loaded from jsDelivr, so the first load needs a network connection.

## Tests

```bash
node tests/learning.mjs 7 5    # lagoon seed 7, a tap every 5 s; prints learned vs untrained plankton per species
node tests/entering.mjs        # every ray added from the toolbar must swim into the lagoon
```

## Files

| file | what it holds |
| --- | --- |
| `web/env.js` | the world: depth map, species, plankton and scent, nettles, weather, ripples, one step of every creature |
| `web/gym.js` | features, the habit, practice swims and the evolution-strategies trainer |
| `web/shallows.js` | the page: sizing, the main loop, pointer handling, the live learned-vs-untrained check |
| `web/water.js` | the water shader (sand, depth colour, caustics, ripples, rain, shadows) |
| `web/creatures.js` | ray and jelly meshes and shaders, tails and tentacles, shadows, picking |
| `web/ui.js` | toolbar, census, learning panel, hints, keyboard |
| `web/sound.js` | optional surf, rain and notes |
