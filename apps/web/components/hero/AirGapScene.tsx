'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * The air gap, in three dimensions.
 *
 * This is a diagram rather than an ornament, and like everything else on this
 * site it is not allowed to claim anything untrue. It shows the one structural
 * fact that defines the device: there are two worlds, nothing is connected
 * across the boundary between them, and the only way data crosses is one
 * discrete parcel at a time, because a human picked it up and carried it.
 *
 * Left of the boundary is the networked world, drawn as a mesh whose nodes are
 * densely linked to each other. Right of it is a single node with no links at
 * all. That asymmetry is the whole picture. Nothing streams across, nothing
 * pulses along a wire between them, and there is no line joining the two sides,
 * because a line would be a lie.
 *
 * Occasionally one parcel detaches from the mesh, crosses slowly, and is
 * absorbed by the isolated node. Slowly on purpose: the real operation is a
 * person holding a phone up to a camera or walking an SD card across a desk,
 * and an animation that made it look like a data link would be describing a
 * different device.
 *
 * Discipline, all of which matters on a page that argues for restraint:
 *   - dropped entirely under prefers-reduced-motion, not merely slowed
 *   - paused when the canvas leaves the viewport or the tab is hidden
 *   - every geometry, material and the renderer disposed on unmount
 *   - no post-processing, no bloom, no glow: this is a technical drawing
 *   - purely decorative to a screen reader, and marked so
 */

const MESH_NODES = 34
const MESH_LINK_DISTANCE = 1.35
const PARCEL_INTERVAL_MS = 5200
const PARCEL_TRAVEL_MS = 3400

const FOV = 38
const CAMERA_DISTANCE = 10.5

/**
 * The diagram's own extent in world units, used to frame it against whatever
 * viewport it lands in. Mesh nodes run from -3.4 to -0.8 on x, the device sits
 * at 3.1 with a radius of 0.46, and the boundary dashes span -1.9 to 1.9 on y.
 * Keep these in step with the geometry below.
 */
const DIAGRAM_WIDTH = 7.0
const DIAGRAM_HEIGHT = 4.0
const DIAGRAM_CENTRE_X = 0.08

/**
 * Matches --color-signal-500 and the ink ramp in styles/globals.css.
 *
 * These are brighter than the ink ramp values they correspond to, because the
 * scene sits under a dark gradient that exists to keep the headline legible.
 * Colours picked against the bare background disappeared once that overlay went
 * on top, which is the usual way a backdrop ends up as an expensive black
 * rectangle.
 */
const COLOR_MESH = 0x8892a3
const COLOR_LINK = 0x5c6675
const COLOR_DEVICE = 0xe8833a
const COLOR_PARCEL = 0xf39c5c

export function AirGapScene() {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (mount === null) return

    // Motion is the first thing to go, not the last. Someone who has asked the
    // operating system for less movement has already told us what they want.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return

    let disposed = false
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
    camera.position.set(0, 0.25, CAMERA_DISTANCE)
    camera.lookAt(0, 0, 0)

    // Probe for WebGL BEFORE constructing the renderer. Three logs an error to
    // the console on its way to throwing, so a try/catch around the constructor
    // degrades silently for the user but still leaves noise in the console, and
    // the deployed-site check treats a console error as a broken page. Asking a
    // throwaway canvas first is the only way to fail quietly.
    const probe = document.createElement('canvas')
    const supportsWebGL =
      probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null
    if (!supportsWebGL) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      // Context creation can still fail after a successful probe, for instance
      // when the GPU process dies. The page is complete without the scene.
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const world = new THREE.Group()
    scene.add(world)

    // --- The networked side: many nodes, densely interlinked ---------------
    const meshPositions: THREE.Vector3[] = []
    for (let i = 0; i < MESH_NODES; i += 1) {
      meshPositions.push(
        new THREE.Vector3(
          -3.4 + Math.random() * 2.6,
          -1.5 + Math.random() * 3.0,
          -1.2 + Math.random() * 2.4
        )
      )
    }

    const nodeGeometry = new THREE.SphereGeometry(0.055, 10, 10)
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: COLOR_MESH })
    const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, MESH_NODES)
    const dummy = new THREE.Object3D()
    meshPositions.forEach((p, i) => {
      dummy.position.copy(p)
      dummy.updateMatrix()
      nodes.setMatrixAt(i, dummy.matrix)
    })
    nodes.instanceMatrix.needsUpdate = true
    world.add(nodes)

    // Links. Density is the point: this side is connected to everything, which
    // is exactly the property the device does not have.
    const linkPoints: number[] = []
    for (let i = 0; i < MESH_NODES; i += 1) {
      for (let j = i + 1; j < MESH_NODES; j += 1) {
        const a = meshPositions[i]
        const b = meshPositions[j]
        if (a === undefined || b === undefined) continue
        if (a.distanceTo(b) < MESH_LINK_DISTANCE) {
          linkPoints.push(a.x, a.y, a.z, b.x, b.y, b.z)
        }
      }
    }
    const linkGeometry = new THREE.BufferGeometry()
    linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linkPoints, 3))
    const linkMaterial = new THREE.LineBasicMaterial({
      color: COLOR_LINK,
      transparent: true,
      opacity: 0.85,
    })
    const links = new THREE.LineSegments(linkGeometry, linkMaterial)
    world.add(links)

    // --- The boundary ------------------------------------------------------
    // Drawn as a row of short dashes rather than a solid plane. A wall suggests
    // something is being held back; the truth is quieter, that there is simply
    // nothing joining the two sides.
    const boundaryPoints: number[] = []
    for (let y = -1.9; y <= 1.9; y += 0.22) {
      boundaryPoints.push(-0.05, y, 0, -0.05, y + 0.1, 0)
    }
    const boundaryGeometry = new THREE.BufferGeometry()
    boundaryGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(boundaryPoints, 3)
    )
    const boundaryMaterial = new THREE.LineBasicMaterial({
      color: COLOR_MESH,
      transparent: true,
      opacity: 0.5,
    })
    const boundary = new THREE.LineSegments(boundaryGeometry, boundaryMaterial)
    world.add(boundary)

    // --- The device: one node, no links ------------------------------------
    const deviceGeometry = new THREE.IcosahedronGeometry(0.46, 0)
    const deviceMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_DEVICE,
      wireframe: true,
    })
    const device = new THREE.Mesh(deviceGeometry, deviceMaterial)
    device.position.set(3.1, 0.05, 0)
    world.add(device)

    // --- The parcel: the only thing that ever crosses ----------------------
    const parcelGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16)
    const parcelMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_PARCEL,
      transparent: true,
      opacity: 0,
    })
    const parcel = new THREE.Mesh(parcelGeometry, parcelMaterial)
    world.add(parcel)

    const parcelStart = new THREE.Vector3(-0.9, 0.1, 0.4)
    const parcelEnd = device.position.clone()
    let parcelStartedAt = -Infinity

    // --- Sizing and framing -------------------------------------------------
    //
    // The diagram is positioned from the measured viewport rather than from
    // hard-coded coordinates. An earlier version placed the mesh and the device
    // at fixed world positions tuned against one window size, and at any other
    // aspect ratio the composition slid sideways until the device drifted off
    // the edge entirely, leaving a backdrop that showed half a diagram and made
    // no argument at all.
    //
    // Two things are computed here. How wide the world is at the plane the
    // diagram sits on, which follows from the field of view and the distance,
    // and therefore where to put the diagram so its centre lands at a chosen
    // fraction across the canvas. On a wide screen that fraction sits right of
    // the headline; on a narrow one the text covers the full width, so the
    // diagram centres and dims instead of hiding behind the words.
    const resize = () => {
      const { clientWidth, clientHeight } = mount
      if (clientWidth === 0 || clientHeight === 0) return
      renderer.setSize(clientWidth, clientHeight, false)

      const aspect = clientWidth / clientHeight
      camera.aspect = aspect
      camera.updateProjectionMatrix()

      const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan((FOV * Math.PI) / 360)
      const visibleWidth = visibleHeight * aspect

      // On a wide screen the copy occupies a `max-w-2xl` column inside a
      // `max-w-5xl` page, which ends around 62% of the way across. The diagram
      // is fitted into the band to the right of that, because the gradient over
      // the text has to stay opaque enough to read against and anything drawn
      // under it is invisible however bright it is. An earlier version centred
      // the mesh at 53% and it simply could not be seen.
      const wide = clientWidth >= 900
      const span = wide ? 0.34 : 0.86
      const scale = Math.min(
        1,
        (visibleWidth * span) / DIAGRAM_WIDTH,
        (visibleHeight * (wide ? 0.86 : 0.7)) / DIAGRAM_HEIGHT
      )
      world.scale.setScalar(scale)

      // Clear of the copy when there is room beside it, centred when there is
      // not and the text spans the full width anyway.
      const centreFraction = wide ? 0.75 : 0.5
      world.position.x = (centreFraction - 0.5) * visibleWidth - DIAGRAM_CENTRE_X * scale
      world.position.y = wide ? 0 : -visibleHeight * 0.04
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)

    // --- Run only when it can be seen --------------------------------------
    let visible = true
    let frame = 0
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false
        if (visible && frame === 0) frame = requestAnimationFrame(tick)
      },
      { threshold: 0 }
    )
    intersectionObserver.observe(mount)

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else if (visible && frame === 0) {
        frame = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const started = performance.now()

    function tick(now: number) {
      if (disposed) return
      frame = requestAnimationFrame(tick)
      if (!visible || document.hidden) return

      const elapsed = now - started

      // A slow drift, not a spin. The scene should reward a second look and
      // never compete with the text beside it.
      world.rotation.y = Math.sin(elapsed / 14000) * 0.22
      world.rotation.x = Math.sin(elapsed / 19000) * 0.07
      device.rotation.y = elapsed / 6000
      device.rotation.x = elapsed / 9000

      if (elapsed - parcelStartedAt > PARCEL_INTERVAL_MS) parcelStartedAt = elapsed

      const parcelAge = elapsed - parcelStartedAt
      if (parcelAge <= PARCEL_TRAVEL_MS) {
        const t = parcelAge / PARCEL_TRAVEL_MS
        // Ease in and out: a person picking something up and setting it down,
        // not a packet on a wire.
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        parcel.position.lerpVectors(parcelStart, parcelEnd, eased)
        parcel.position.y += Math.sin(eased * Math.PI) * 0.5
        parcel.rotation.x = eased * 3
        parcel.rotation.y = eased * 2
        // Fade in and out at the ends so nothing appears or vanishes abruptly.
        parcelMaterial.opacity = Math.sin(eased * Math.PI) * 0.9
      } else {
        parcelMaterial.opacity = 0
      }

      renderer.render(scene, camera)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)

      // Three does not release GPU memory on garbage collection. A route change
      // that left these behind would leak a context per visit.
      nodeGeometry.dispose()
      nodeMaterial.dispose()
      nodes.dispose()
      linkGeometry.dispose()
      linkMaterial.dispose()
      boundaryGeometry.dispose()
      boundaryMaterial.dispose()
      deviceGeometry.dispose()
      deviceMaterial.dispose()
      parcelGeometry.dispose()
      parcelMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="absolute inset-0 -z-10 pointer-events-none"
    />
  )
}
