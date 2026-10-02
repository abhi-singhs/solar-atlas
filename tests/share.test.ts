import { describe, expect, it } from 'vitest'
import { MAX_STOPS } from '../src/flight/route'
import { buildShareLink, parseShareLink, shareQuery } from '../src/navigation/share'
import type { SharedJourney } from '../src/navigation/share'

const settings = {
  shipModel: 'voyager', labels: false, paths: true, exposure: 1.25, fov: 62, lensFlare: false, glareHidesStars: true, music: false, musicVolume: 0.4,
}

const explore: SharedJourney = {
  mode: 'explore', bodyId: 'mars', utc: '2026-12-25T18:30:05Z', observerMode: 'follow',
  framing: { theta: -1.2, phi: 1.05, distanceKm: 748000000, targetId: 'sun' }, timeScale: 86400, playing: true,
  settings, theme: 'light', uiHidden: true,
}

const ship: SharedJourney = {
  mode: 'ship', bodyId: 'earth', utc: '2026-09-05T00:01:10Z',
  route: [{ bodyId: 'moon', action: 'land' }, { bodyId: 'mars', action: 'arrive' }, { bodyId: 'churyumov-gerasimenko', action: 'arrive' }],
  routeAutoContinue: false, routeAutoSpeed: true, camera: 'chase', warp: true, throttleC: 12.5, settings, theme: 'dark',
}

const parse = (journey: SharedJourney) => parseShareLink(`?${shareQuery(journey)}`)

describe('share links', () => {
  it('round-trips an Explore view with its framing, clock, and settings', () => {
    expect(parse(explore)).toEqual({ journey: explore, problems: [] })
  })

  it('round-trips a Spaceship route with land actions, warp, and camera', () => {
    expect(parse(ship)).toEqual({ journey: ship, problems: [] })
  })

  it('writes a readable query that keeps commas, tildes, and colons unescaped', () => {
    const query = shareQuery(ship)
    expect(query).toContain('route=moon~land,mars,churyumov-gerasimenko')
    expect(query).toContain('t=2026-09-05T00:01:10Z')
    expect(query).not.toMatch(/%2C|%7E|%3A/i)
    expect(shareQuery(explore)).toContain('view=-1.2,1.05,748000000,sun')
  })

  it('leaves the framing body out when it is the selected body, and rounds angles', () => {
    const query = shareQuery({ ...explore, framing: { theta: 7, phi: 0.123456789, distanceKm: 21974.123456, targetId: 'mars' } })
    expect(query).toContain(`view=${Number((7 - 2 * Math.PI).toFixed(4))},0.1235,21974.1&`)
  })

  it('builds the link on the current page and drops its old query and hash', () => {
    const link = buildShareLink('https://example.org/solar-atlas/index.html?scoutTheme=dark#top', { mode: 'explore', bodyId: 'moon', settings: {} })
    expect(link).toBe('https://example.org/solar-atlas/index.html?v=1&mode=explore&body=moon')
  })

  it('ignores a URL without a version, so normal visits and test hooks are untouched', () => {
    expect(parseShareLink('')).toEqual({ journey: null, problems: [] })
    expect(parseShareLink('?scoutTheme=dark&body=mars')).toEqual({ journey: null, problems: [] })
  })

  it('refuses a newer share format', () => {
    const { journey, problems } = parseShareLink('?v=2&body=mars')
    expect(journey).toBeNull()
    expect(problems[0]).toContain('v=2')
  })

  it('drops each bad value on its own and keeps the rest', () => {
    const { journey, problems } = parseShareLink('?v=1&body=Mars!&fov=200&ev=1&music=maybe&ship=enterprise&labels=0&t=2026-02-30&theme=blue&ui=gone')
    expect(journey).toEqual({ mode: 'explore', settings: { labels: false, exposure: 1 } })
    expect(problems).toHaveLength(7)
    expect(problems.join(' | ')).toMatch(/body=Mars!.*t=2026-02-30.*ship=enterprise.*fov=200.*music=maybe.*theme=blue.*ui=gone/)
  })

  it('accepts shorter hand-written dates and lenient switches', () => {
    expect(parseShareLink('?v=1&t=2027-01-01&labels=off').journey).toMatchObject({ utc: '2027-01-01T00:00:00Z', settings: { labels: false } })
    expect(parseShareLink('?v=1&t=2027-01-01T06:30').journey?.utc).toBe('2027-01-01T06:30:00Z')
  })

  it('picks Spaceship mode for a route without a mode, and flags params from the other mode', () => {
    expect(parseShareLink('?v=1&route=moon').journey).toMatchObject({ mode: 'ship', route: [{ bodyId: 'moon', action: 'arrive' }] })
    const { journey, problems } = parseShareLink('?v=1&mode=explore&route=moon&warp=1&cam=free')
    expect(journey).toEqual({ mode: 'explore', observerMode: 'free', settings: {} })
    expect(problems).toEqual(['route, warp, which only apply in Spaceship mode'])
  })

  it('caps a route, drops duplicates, and parks stops with an unknown action', () => {
    const ids = Array.from({ length: MAX_STOPS + 2 }, (_, i) => `body${i}`)
    const { journey, problems } = parseShareLink(`?v=1&route=${['moon~hover', 'moon', ...ids].join(',')},`)
    expect(journey?.route).toHaveLength(MAX_STOPS)
    expect(journey?.route?.[0]).toEqual({ bodyId: 'moon', action: 'arrive' })
    expect(problems).toEqual([
      'route action moon~hover, expected land or arrive, so the ship parks nearby',
      'route stop moon, which appears twice',
      `route stops after the first ${MAX_STOPS}, the most a route holds`,
    ])
  })

  it('needs warp for a commanded speed at or above c', () => {
    expect(parseShareLink('?v=1&mode=ship&throttle=5').problems[0]).toContain('below 1c')
    expect(parseShareLink('?v=1&mode=ship&warp=1&throttle=5').journey?.throttleC).toBe(5)
    expect(parseShareLink('?v=1&mode=ship&throttle=0.00000001').journey?.throttleC).toBe(1e-8)
  })

  it('rejects framing that is not three finite numbers with a valid elevation', () => {
    for (const view of ['1,2', '1,2,3,mars,x', '1,2,-5', 'a,0,10', '0,1.6,10', '0,0,10,Sun']) {
      expect(parseShareLink(`?v=1&view=${view}`).problems).toHaveLength(1)
    }
  })

  it('rejects a zero or out-of-range time rate', () => {
    expect(parseShareLink('?v=1&rate=0').problems).toHaveLength(1)
    expect(parseShareLink('?v=1&rate=-604801').problems).toHaveLength(1)
    expect(parseShareLink('?v=1&rate=-3600').journey?.timeScale).toBe(-3600)
  })
})
