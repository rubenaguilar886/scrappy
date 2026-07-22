import { useState, useEffect, useRef } from 'react'
import { ArrowRight, Clock, Menu, X, Link } from 'lucide-react'
import ShaderBackground from './components/ShaderBackground'

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

/** Text-roll animation: duplicate text in a flex-col, slides up on hover */
function RollText({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span className={`inline-flex flex-col overflow-hidden h-[1.25em] ${className}`}>
      <span
        className="flex flex-col transition-transform duration-500"
        style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
        data-roll
      >
        <span>{children}</span>
        <span aria-hidden>{children}</span>
      </span>
    </span>
  )
}

/* Wrap roll-text in a group so parent hover triggers CSS via group-hover */
function RollBtn({
  children,
  href = '#',
  className = '',
  arrowBg = 'bg-white',
  arrowColor = 'text-[#7C3AED]',
  onClick,
}: {
  children: string
  href?: string
  className?: string
  arrowBg?: string
  arrowColor?: string
  onClick?: () => void
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={`group inline-flex items-center gap-2 rounded-full font-medium select-none ${className}`}
      style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
    >
      <span
        className="inline-flex flex-col overflow-hidden"
        style={{ height: '1.25em' }}
      >
        <span
          className="flex flex-col transition-transform duration-500 group-hover:-translate-y-1/2"
          style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
        >
          <span>{children}</span>
          <span aria-hidden>{children}</span>
        </span>
      </span>
      <span
        className={`inline-flex items-center justify-center rounded-full transition-transform duration-500 ${arrowBg} ${arrowColor}`}
        style={{
          width: '1.75rem', height: '1.75rem', flexShrink: 0,
          transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)',
        }}
      >
        <ArrowRight
          size={14}
          className="transition-transform duration-500 -rotate-45 group-hover:rotate-0"
          style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
        />
      </span>
    </a>
  )
}

/* ─────────────────────────────────────────────
   NAVBAR
───────────────────────────────────────────── */
function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [londonTime, setLondonTime] = useState('')

  // Live Lima time (GMT-5)
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const t = now.toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
      setLondonTime(t)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const navLinks = ['Proyectos', 'Servicios', 'Proceso', 'Contacto']

  return (
    <>
      <nav className="relative z-20 flex justify-center px-3 pt-3 sm:pt-4">
        <div
          className="w-full max-w-[1440px] bg-white rounded-full"
          style={{ padding: '5px' }}
        >
          <div className="flex items-center justify-between px-2 sm:px-3 py-1">
            {/* LEFT: logo + links */}
            <div className="flex items-center gap-6">
              {/* Logo */}
              <a href="#" className="flex items-center gap-2.5 flex-shrink-0">
                <div
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gray-900 flex items-center justify-center"
                  style={{ flexShrink: 0 }}
                >
                  <svg width="22" height="26" viewBox="-8 -8 76 96" fill="none">
                    <defs>
                      <linearGradient id="sg-n" x1="60" y1="0" x2="0" y2="70" gradientUnits="userSpaceOnUse">
                        <stop offset="0%"  stopColor="#22D3EE"/>
                        <stop offset="48%" stopColor="#7C3AED"/>
                        <stop offset="100%" stopColor="#EC4899"/>
                      </linearGradient>
                    </defs>
                    <path d="M48,18 C52,7 48,3 36,4 C22,5 10,15 14,28 C17,38 30,42 38,44 C47,46 56,52 53,64 C50,74 38,77 27,75 C16,73 11,64 14,55"
                      stroke="url(#sg-n)" strokeWidth="13" strokeLinecap="round" fill="none"/>
                  </svg>
                </div>
                <span className="hidden sm:block text-sm font-semibold text-gray-900 tracking-tight">Scrappy</span>
              </a>
              {/* Nav links */}
              <div className="hidden md:flex items-center gap-6">
                {navLinks.map(l => (
                  <a
                    key={l}
                    href={`#${l.toLowerCase()}`}
                    className="text-sm text-gray-900 hover:text-gray-500 transition-colors duration-300"
                  >
                    {l}
                  </a>
                ))}
              </div>
            </div>

            {/* RIGHT: time + CTA */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-3">
                <span className="text-xs text-gray-500 hidden lg:block">
                  Proyectos disponibles Q3 2026
                </span>
                <div className="flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-400" />
                  <span className="text-xs text-gray-500">{londonTime} Lima</span>
                </div>
              </div>
              {/* CTA button */}
              <a
                href="https://wa.me/51984235158?text=Hola%2C%20quiero%20cotizar%20una%20p%C3%A1gina%20web"
                target="_blank"
                rel="noopener"
                className="hidden md:inline-flex group items-center gap-2 bg-gray-900 text-white text-xs font-medium rounded-full pl-4 pr-1.5 py-2"
                style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
              >
                <span
                  className="inline-flex flex-col overflow-hidden"
                  style={{ height: '1.2em' }}
                >
                  <span
                    className="flex flex-col transition-transform duration-500 group-hover:-translate-y-1/2"
                    style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
                  >
                    <span>Cotiza tu web</span>
                    <span aria-hidden>Cotiza tu web</span>
                  </span>
                </span>
                <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
                  <ArrowRight
                    size={12}
                    className="text-gray-900 transition-transform duration-500 -rotate-45 group-hover:rotate-0"
                    style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
                  />
                </span>
              </a>
              {/* Mobile menu toggle */}
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="md:hidden flex items-center gap-1.5 bg-gray-900 text-white text-xs font-medium rounded-full px-3 py-2"
                aria-label="Toggle menu"
              >
                {menuOpen ? <X size={14} /> : <Menu size={14} />}
                <span>{menuOpen ? 'Cerrar' : 'Menú'}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          {/* Bottom sheet */}
          <div
            className="absolute bottom-3 left-3 right-3 bg-white rounded-2xl p-6 flex flex-col gap-6"
            style={{
              animation: 'slideUp 0.4s cubic-bezier(0.32,0.72,0,1) forwards',
            }}
          >
            <style>{`@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock size={12} />
              <span>{londonTime} Lima</span>
            </div>
            <nav className="flex flex-col gap-4">
              {navLinks.map(l => (
                <a
                  key={l}
                  href={`#${l.toLowerCase()}`}
                  onClick={() => setMenuOpen(false)}
                  className="text-2xl font-medium text-gray-900 hover:text-gray-500 transition-colors"
                >
                  {l}
                </a>
              ))}
            </nav>
            <RollBtn
              href="https://wa.me/51984235158?text=Hola%2C%20quiero%20cotizar%20una%20p%C3%A1gina%20web"
              className="bg-[#7C3AED] text-white text-sm pl-5 pr-2 py-2.5 self-start"
              arrowBg="bg-white"
              arrowColor="text-[#7C3AED]"
            >
              Quiero mi web
            </RollBtn>
          </div>
        </div>
      )}
    </>
  )
}

/* ─────────────────────────────────────────────
   HERO — Section 1
───────────────────────────────────────────── */

/* Starburst / certified badge SVG (adapted from prompt) */
const StarburstSVG = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-5 h-5 sm:w-6 sm:h-6 fill-current text-[#7C3AED]">
    <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/>
  </svg>
)

function Hero() {
  return (
    <section
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{ background: '#EFEFEF' }}
    >
      {/* WebGL shader background */}
      <ShaderBackground />

      {/* Navbar sits at top */}
      <Navbar />

      {/* Hero content anchored to bottom */}
      <div className="relative z-20 flex-1 flex items-end">
        <div className="w-full max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 pb-14 sm:pb-16 lg:pb-20">
          {/* Label */}
          <p className="text-xs sm:text-sm text-gray-900 tracking-widest mb-5 sm:mb-8 uppercase">
            Scrappy Studio
          </p>

          {/* Headline */}
          <h1
            className="font-medium text-gray-900 leading-[1.08] tracking-[-0.03em] mb-8 sm:mb-12"
            style={{
              fontSize: 'clamp(1.75rem, 7vw, 4.2rem)',
            }}
          >
            Webs que convierten<span className="hidden sm:inline"> de verdad</span>
            <br className="hidden sm:block" />
            <span className="sm:hidden"> de verdad </span>
            para negocios listos
            <br className="hidden sm:block" />
            {' '}para dominar su categoría online.
          </h1>

          {/* CTA row */}
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-5">
            {/* Primary CTA */}
            <RollBtn
              href="https://wa.me/51984235158?text=Hola%2C%20quiero%20cotizar%20una%20p%C3%A1gina%20web%20para%20mi%20negocio"
              className="bg-[#7C3AED] hover:bg-[#6d28d9] text-white text-sm pl-5 sm:pl-6 pr-2 py-2"
              arrowBg="bg-white"
              arrowColor="text-[#7C3AED]"
            >
              Quiero mi web
            </RollBtn>

            {/* Partner badge */}
            <div
              className="flex items-center gap-2.5 bg-white rounded-[6px] px-3 py-2 cursor-default"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)', transition: 'box-shadow 0.3s ease' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
            >
              <StarburstSVG />
              <span className="text-xs sm:text-sm font-medium text-gray-900">Entrega en 10 días</span>
              <span className="bg-gray-900 text-white text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded font-medium">
                Sin mensualidades
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────
   ABOUT — Section 2
───────────────────────────────────────────── */
function About() {
  const IMG_SMALL = 'https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=800&q=80'
  const IMG_LARGE = 'https://images.unsplash.com/photo-1547658719-da2b51169166?w=1280&q=80'

  return (
    <section id="servicios" className="bg-white overflow-hidden pt-16 sm:pt-20 lg:pt-32 pb-12 sm:pb-16 lg:pb-24">
      <div className="max-w-[1440px] mx-auto">
        {/* Badge row */}
        <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-[11px] sm:text-xs font-semibold flex-shrink-0">
            1
          </div>
          <span className="text-xs sm:text-sm font-medium border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-700">
            Conoce a Scrappy
          </span>
        </div>

        {/* Heading */}
        <h2
          className="font-medium text-gray-900 leading-[1.12] tracking-[-0.02em] mb-12 sm:mb-16 lg:mb-28 px-5 sm:px-8 lg:px-12"
          style={{ fontSize: 'clamp(1.5rem, 4vw, 3.2rem)' }}
        >
          Creatividad con estrategia,<br />
          resultados en digital y más.
        </h2>

        {/* Content — mobile/tablet */}
        <div className="lg:hidden px-5 sm:px-8 flex flex-col gap-10">
          <div>
            <p className="text-[15px] sm:text-[17px] leading-[1.6] font-medium text-gray-900 mb-6">
              A través de investigación, diseño estratégico e iteración constante, ayudamos a negocios
              locales a aprovechar todo su potencial digital.
            </p>
            <RollBtn
              href="https://wa.me/51984235158"
              className="bg-[#7C3AED] text-white text-sm pl-5 pr-2 py-2"
              arrowBg="bg-white"
              arrowColor="text-[#7C3AED]"
            >
              Sobre nosotros
            </RollBtn>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
            <img
              src={IMG_SMALL}
              alt="Diseño web estratégico"
              className="sm:w-[45%] rounded-xl sm:rounded-2xl object-cover"
              style={{ aspectRatio: '438/346' }}
            />
            <img
              src={IMG_LARGE}
              alt="Trabajo en Scrappy Studio"
              className="sm:w-[55%] rounded-xl sm:rounded-2xl object-cover"
              style={{ aspectRatio: '900/600' }}
            />
          </div>
        </div>

        {/* Content — desktop grid */}
        <div className="hidden lg:grid grid-cols-[26%_1fr_48%] items-end gap-6 xl:gap-8 px-12">
          {/* Left: small image */}
          <div className="self-end">
            <img
              src={IMG_SMALL}
              alt="Diseño web estratégico"
              className="w-full rounded-2xl object-cover"
              style={{ aspectRatio: '438/346' }}
            />
          </div>
          {/* Center: text + CTA */}
          <div className="self-start flex flex-col items-start pt-4">
            <p className="text-[16px] sm:text-[18px] leading-[1.65] font-medium text-gray-900 mb-8 whitespace-nowrap">
              A través de investigación, diseño<br />
              estratégico e iteración constante,<br />
              ayudamos a negocios locales a<br />
              aprovechar todo su potencial digital.
            </p>
            <RollBtn
              href="https://wa.me/51984235158"
              className="bg-[#7C3AED] text-white text-sm pl-5 pr-2 py-2"
              arrowBg="bg-white"
              arrowColor="text-[#7C3AED]"
            >
              Sobre nosotros
            </RollBtn>
          </div>
          {/* Right: large image */}
          <div className="self-end">
            <img
              src={IMG_LARGE}
              alt="Trabajo en Scrappy Studio"
              className="w-full rounded-2xl object-cover"
              style={{ aspectRatio: '3/2' }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────
   PROJECT CARD component
───────────────────────────────────────────── */
interface ProjectCardProps {
  iframeSrc: string
  title: string
  description: string
  tag: string
  dark?: boolean
}

function ProjectCard({ iframeSrc, title, description, tag, dark = false }: ProjectCardProps) {
  const btnLabel = dark ? 'View case study' : 'Ver proyecto'
  const bgCard   = dark ? 'bg-[#1a1d2e]' : 'bg-[#f0ede8]'

  return (
    <div>
      {/* Preview container */}
      <div className={`relative rounded-2xl overflow-hidden group cursor-pointer ${bgCard}`}
        style={{ aspectRatio: dark ? '329/246' : '1/1' }}>
        {/* Scaled iframe preview */}
        <div className="absolute inset-0 overflow-hidden">
          <iframe
            src={iframeSrc}
            className="absolute top-0 left-0 border-none pointer-events-none"
            style={{
              width: '1280px', height: dark ? '960px' : '1280px',
              transform: 'scale(0.42)',
              transformOrigin: 'top left',
            }}
            loading="lazy"
            scrolling="no"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>

        {/* Hover reveal button */}
        <div className="absolute bottom-4 left-4">
          <div
            className={`relative flex items-center overflow-hidden rounded-full transition-all duration-300 ease-in-out ${dark ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'}`}
            style={{ height: '2.25rem', width: '2.25rem' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.width = dark ? '148px' : '168px'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.width = '2.25rem'
            }}
          >
            <span
              className={`absolute left-3 text-xs font-medium whitespace-nowrap transition-opacity duration-200 delay-100 opacity-0 group-hover:opacity-100 ${dark ? 'text-gray-900' : 'text-white'}`}
            >
              {btnLabel}
            </span>
            <span className="absolute right-2 flex-shrink-0">
              <Link
                size={13}
                className={`transition-transform duration-300 -rotate-45 group-hover:rotate-0 ${dark ? 'text-gray-900' : 'text-white'}`}
                style={{ transitionTimingFunction: 'cubic-bezier(0.25,0.1,0.25,1)' }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* Text below */}
      <p className="text-xs sm:text-sm text-gray-500 mt-4 leading-relaxed">{description}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs sm:text-sm font-semibold text-gray-900">{title}</span>
        <span className="text-[10px] font-medium text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">{tag}</span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   PROJECTS — Section 3
───────────────────────────────────────────── */
function Projects() {
  return (
    <section
      id="proyectos"
      className="pt-16 sm:pt-20 lg:pt-28 pb-16 sm:pb-20 lg:pb-28"
      style={{ background: '#F5F5F5' }}
    >
      <div className="max-w-[1440px] mx-auto">
        {/* Badge */}
        <div className="px-5 sm:px-8 lg:px-12 flex items-center gap-3 mb-6 sm:mb-8">
          <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gray-900 text-white flex items-center justify-center text-[11px] sm:text-xs font-semibold flex-shrink-0">
            2
          </div>
          <span className="text-xs sm:text-sm font-medium border border-gray-300 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-700">
            Nuestro trabajo
          </span>
        </div>

        {/* Heading */}
        <h2
          className="font-medium text-gray-900 leading-[1.08] tracking-[-0.03em] mb-10 sm:mb-14 lg:mb-16 px-5 sm:px-8 lg:px-12"
          style={{ fontSize: 'clamp(1.75rem, 7vw, 4.2rem)' }}
        >
          Nuestros proyectos
        </h2>

        {/* Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 lg:gap-7 px-5 sm:px-8 lg:px-12">
          <ProjectCard
            iframeSrc="https://timely-syrniki-8b62c5.netlify.app/"
            title="Sacred Ink Studio"
            description="Landing dark & moody para estudio de tatuajes. Galería, perfiles de artistas, FAQ y reservas."
            tag="Tatuajes · Lima"
            dark
          />
          <ProjectCard
            iframeSrc="https://snazzy-fox-8fb7f5.netlify.app/"
            title="Diego Ríos Fotografía"
            description="Portfolio editorial oscuro para fotógrafo freelance. Galería B&W en grid y contacto."
            tag="Fotografía · Lima"
          />
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────
   FOOTER
───────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="bg-white border-t border-gray-100 px-5 sm:px-8 lg:px-12 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="max-w-[1440px] mx-auto w-full flex flex-col sm:flex-row items-center justify-between gap-4">
        <a href="#" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center">
            <svg width="16" height="19" viewBox="-8 -8 76 96" fill="none">
              <defs>
                <linearGradient id="sg-ft" x1="60" y1="0" x2="0" y2="70" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"  stopColor="#22D3EE"/>
                  <stop offset="48%" stopColor="#7C3AED"/>
                  <stop offset="100%" stopColor="#EC4899"/>
                </linearGradient>
              </defs>
              <path d="M48,18 C52,7 48,3 36,4 C22,5 10,15 14,28 C17,38 30,42 38,44 C47,46 56,52 53,64 C50,74 38,77 27,75 C16,73 11,64 14,55"
                stroke="url(#sg-ft)" strokeWidth="13" strokeLinecap="round" fill="none"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-900">Scrappy Studio</span>
        </a>
        <p className="text-xs text-gray-400">© 2026 Scrappy Studio · Lima, Perú</p>
        <a
          href="https://wa.me/51984235158"
          target="_blank"
          rel="noopener"
          className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          +51 984 235 158
        </a>
      </div>
    </footer>
  )
}

/* ─────────────────────────────────────────────
   APP ROOT
───────────────────────────────────────────── */
export default function App() {
  return (
    <div className="overflow-x-hidden">
      <Hero />
      <About />
      <Projects />
      <Footer />
    </div>
  )
}
