import { Feathers } from "@/components/Feathers";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { AniList } from "@/sections/AniList";
import { Faq } from "@/sections/Faq";
import { Features } from "@/sections/Features";
import { FinalCta } from "@/sections/FinalCta";
import { Gallery } from "@/sections/Gallery";
import { Hero } from "@/sections/Hero";
import { Library } from "@/sections/Library";
import { Offline } from "@/sections/Offline";
import { OpenSource } from "@/sections/OpenSource";
import { Platforms } from "@/sections/Platforms";
import { Problem } from "@/sections/Problem";
import { Scrobbling } from "@/sections/Scrobbling";
import { Statistics } from "@/sections/Statistics";
import { TrustStrip } from "@/sections/TrustStrip";

/** The landing page, top to bottom. */
export function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Feathers />
      <Nav />
      <main id="main">
        <Hero />
        <TrustStrip />
        <Problem />
        <Scrobbling />
        <Library />
        <Offline />
        <Statistics />
        <Features />
        <Gallery />
        <Platforms />
        <AniList />
        <OpenSource />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
