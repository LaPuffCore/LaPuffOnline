import { useEffect, useState } from 'react';

export default function KoganePopup({ onClose }) {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setOpened(true), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[100000] flex items-start justify-center pointer-events-auto">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Top image (sticks to top) */}
      <img src="/data/koganetop.png" alt="kogane top"
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 top-0 w-full max-w-3xl" style={{ maxHeight: '45vh', objectFit: 'cover', zIndex: 100001 }} />

      {/* Bottom image (animated down) */}
      <img src="/data/koganebottom.png" alt="kogane bottom"
        className="pointer-events-none fixed left-1/2 -translate-x-1/2 w-full max-w-3xl transition-transform duration-1000 ease-out"
        style={{ zIndex: 100001, transform: opened ? 'translate(-50%, 35vh)' : 'translate(-50%, 0)' }} />

      {/* Center holographic screen appearing between halves */}
      <div className="relative z-[100002] w-full max-w-2xl mt-24 px-6 py-8 rounded-xl" style={{ pointerEvents: 'auto' }}>
        <div className="mx-auto bg-[rgba(0,255,100,0.09)] border border-[rgba(0,255,100,0.28)] shadow-[0_6px_20px_rgba(0,255,100,0.06)] rounded-lg p-6 backdrop-blur-sm"
          style={{ color: '#021', minHeight: opened ? 240 : 40, transition: 'min-height 600ms ease', boxShadow: '0 6px 30px rgba(0,255,100,0.08), inset 0 0 60px rgba(0,255,100,0.06)' }}>

          <h2 className="text-center font-black text-2xl md:text-4xl mb-4" style={{ color: '#0f0', textShadow: '0 0 6px rgba(0,255,100,0.6)' }}>CLOUT CULLING GAME RULES</h2>

          <div className="prose text-[13px] md:text-sm leading-snug max-h-[60vh] overflow-auto" style={{ color: '#001', fontFamily: 'Nunito, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial' }}>
            <p className="font-black">I. Once a player has awakened their Clout Alias, they must declare their participation in the Clout Culling Games at a zip-colony of their choice within 28 days - these Players are the two types of either Orbiter or Participant.</p>
            <p className="font-black">II. Any Players who break the previous rule will be subject to clout technique removal and coincidingly will be giga-mogged by other players.</p>
            <p className="font-black">III. Orbiters who enter a colony without one chosen become Participants at the moment of entry and will be considered to have declared participation in the Clout Culling Games (Normies already inside a barrier at the start of the games will be given at least one chance to exit safely).</p>
            <p className="font-black">IV. Players score points by engaging in more motion than other Players.</p>
            <p className="font-black">V. Players who refuse to participate by either not joining or becoming inactive will be Simulated at a fraction of their potential and coincidingly will be giga-mogged by other Players.</p>
            <p className="font-black">VI. The point value categories of a Player's motion is decided by Game Master LaPuff. As a general rule, in real life motion is weighted more than digital motion (though both are still counted).</p>
            <div>
              <p className="font-black">VII. Players can expend a set amount of points as determined by Game Master LaPuff to engage one of the three following options:</p>
              <ol className="ml-6 list-decimal" style={{ listStyleType: 'upper-alpha' }}>
                <li className="font-black">Players may add a rule to the Clout Culling Games provided that the rule described does not end the Games. Rules added may not be subtracted.</li>
                <li className="font-black">Players may add a site function to the site which hosts the Clout Culling Games - if this function adds a way for Players to gain or lose points it will be accordingly balanced by Games Master LaPuff.</li>
                <li className="font-black">Players may claim a zip region as theirs to form as an Official Clout Colony gaining a name of their choosing, color of their choosing, and other perks as to be determined by the development of the Game.</li>
              </ol>
            </div>
            <p className="font-black">VIII. In accordance with rule VII, Game Master LaPuff must accept any proposed new addition as long as it doesn't have a destructive effect on the Game.</p>
            <p className="font-black">IX. If a Player's score remains the same for 28 days they will be subject to clout removal and they will enter ‘Fallen Off’ status.</p>
          </div>

          <div className="flex justify-center mt-4">
            <button onClick={onClose} className="px-4 py-2 bg-black text-white rounded-xl font-black">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
