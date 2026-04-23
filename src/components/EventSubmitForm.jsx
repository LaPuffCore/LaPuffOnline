import { useState, useEffect } from 'react';
import { submitEvent, uploadEventPhoto, sendSubmissionEmail } from '../lib/supabase';
import { containsProfanity } from '../lib/profanityFilter';
import { localToUTC, TIMEZONES, getUserTZOffset } from '../lib/timezones';
import EmojiPicker from './EmojiPicker';
import ColorPicker from './ColorPicker';
import AddressSearch from './AddressSearch';
import { useSiteTheme } from '../lib/theme';

const PRICE_OPTIONS = ['free', '$', '$$', '$$$'];
const MAX_PHOTO_BYTES = 500 * 1024; // 500KB target (client-side compressed)

/** Compress a File to ≤ maxBytes using canvas, returns a new File */
async function compressImage(file, maxBytes = MAX_PHOTO_BYTES) {
  if (file.size <= maxBytes) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      // Scale down if very large
      const MAX_DIM = 1920;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxBytes || quality < 0.1) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            quality -= 0.1;
            tryCompress();
          }
        }, 'image/jpeg', quality);
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function EventSubmitForm({ onClose }) {
  const { resolvedTheme } = useSiteTheme();
  const accentColor = resolvedTheme?.accentColor || '#7C3AED';
  const userTz = TIMEZONES.find(t => t.offset === getUserTZOffset()) || TIMEZONES[0];

  const [form, setForm] = useState({
    name: '', event_name: '', price_category: 'free',
    location_type: 'address',
    location_data: { city: 'New York', address: '', zipcode: '', rsvp_link: '' },
    event_date: '', event_time: '', event_end_time: '', timezone: userTz,
    relevant_links: [''], description: '', emoji: '🎉', color: '#7C3AED',
    afters_address: '', afters_lat: null, afters_lng: null,
  });
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState({});

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function validate() {
    const e = {};
    if (!form.event_name.trim()) e.event_name = 'Required';
    if (containsProfanity(form.event_name)) e.event_name = 'Error profanity filter';
    if (!form.event_date) e.event_date = 'Required';
    if (!form.event_time) e.event_time = 'Required';
    if (!form.event_end_time) e.event_end_time = 'Required';
    if (!form.description.trim()) e.description = 'Required';
    if (containsProfanity(form.description)) e.description = 'Error profanity filter';
    if (containsProfanity(form.name)) e.name = 'Error profanity filter';
    if (form.location_type === 'address' && !form.location_data.address) e.address = 'Required';
    if (form.location_type === 'rsvp' && !form.location_data.rsvp_link) e.rsvp_link = 'Required';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    let photoUrls = [];
    for (const f of photoFiles) {
      try { photoUrls.push(await uploadEventPhoto(f)); } catch {}
    }
    const payload = {
      name: form.name, event_name: form.event_name, price_category: form.price_category,
      location_data: form.location_type === 'rsvp'
        ? { city: 'Private/Online', rsvp_link: form.location_data.rsvp_link, zipcode: '' }
        : { ...form.location_data },
      event_date: form.event_date,
      event_time_utc: localToUTC(form.event_date, form.event_time, form.timezone.offset),
      event_time_utc_end: form.event_end_time
        ? localToUTC(form.event_date, form.event_end_time, form.timezone.offset)
        : null,
      relevant_links: form.relevant_links.filter(l => l.trim()) || null,
      description: form.description,
      photos: photoUrls.length ? photoUrls : null,
      representative_emoji: form.emoji, hex_color: form.color, is_approved: false,
      lat: form.location_data.lat || null,
      lng: form.location_data.lng || null,
      afters_address: form.afters_address || null,
      afters_lat: form.afters_lat || null,
      afters_lng: form.afters_lng || null,
    };
    try {
      await submitEvent(payload);
      sendSubmissionEmail();
      setSuccess(true);
    } catch (err) { setErrors({ submit: err.message }); }
    setSubmitting(false);
  }

  async function handlePhotoAdd(e) {
    const rawFiles = Array.from(e.target.files || []).slice(0, 5 - photoFiles.length);
    const compressed = await Promise.all(rawFiles.map(f => compressImage(f)));
    setPhotoFiles(prev => [...prev, ...compressed]);
    setPhotos(prev => [...prev, ...compressed.map(f => URL.createObjectURL(f))]);
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white border-4 border-black rounded-3xl p-10 text-center max-w-sm shadow-[8px_8px_0px_black]" onClick={e => e.stopPropagation()}>
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-black mb-2">Submitted!</h2>
          <p className="text-gray-600 mb-6">Your event is under review. We'll add it soon!</p>
          <button onClick={onClose} className="bg-[#7C3AED] text-white font-black px-8 py-3 rounded-2xl text-lg hover:bg-[#6D28D9] transition-colors">
            Awesome!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border-4 border-black rounded-3xl w-full shadow-[8px_8px_0px_black] flex flex-col"
        style={{ maxWidth: 900, maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b-3 border-black flex-shrink-0">
          <h2 className="text-xl font-black">Submit an Event 🗽</h2>
          <button onClick={onClose} className="w-9 h-9 bg-black text-white rounded-full font-black text-lg hover:bg-red-500 transition-colors flex items-center justify-center">✕</button>
        </div>

        {/* Two-column scrollable body */}
        <div className="overflow-y-auto flex-1">
          <form onSubmit={handleSubmit} className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column */}
              <div className="space-y-4">
                {/* Your name */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Your Name</label>
                  <input value={form.name} onChange={e => setField('name', e.target.value)}
                    placeholder="Who's organizing?"
                    className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]" />
                </div>

                {/* Event name */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Event Name *</label>
                  <input value={form.event_name} onChange={e => setField('event_name', e.target.value)}
                    placeholder="What's happening?"
                    className={`w-full border-3 ${errors.event_name ? 'border-red-500' : 'border-black'} rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]`} />
                  {errors.event_name && <p className="text-red-500 text-xs mt-1">⚠ {errors.event_name}</p>}
                </div>

                {/* Price + Emoji + Color */}
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Price</label>
                    <div className="flex gap-1">
                      {PRICE_OPTIONS.map(p => (
                        <button key={p} type="button" onClick={() => setField('price_category', p)}
                          className={`px-2.5 py-1.5 rounded-xl font-black text-xs border-3 border-black transition-colors ${form.price_category === p ? 'bg-[#7C3AED] text-white' : 'bg-white hover:bg-violet-50'}`}>
                          {p === 'free' ? 'FREE' : p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Emoji</label>
                    <EmojiPicker value={form.emoji} onChange={e => setField('emoji', e)} />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Color</label>
                    <ColorPicker value={form.color} onChange={c => setField('color', c)} />
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Location *</label>
                  <div className="flex gap-2 mb-2">
                    <button type="button" onClick={() => setField('location_type', 'address')}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs border-3 border-black ${form.location_type === 'address' ? 'bg-[#7C3AED] text-white' : 'bg-white hover:bg-violet-50'}`}>
                      📍 Address
                    </button>
                    <button type="button" onClick={() => setField('location_type', 'rsvp')}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs border-3 border-black ${form.location_type === 'rsvp' ? 'bg-[#7C3AED] text-white' : 'bg-white hover:bg-violet-50'}`}>
                      🔒 RSVP Link
                    </button>
                  </div>
                  {form.location_type === 'address' ? (
                    <>
                      <AddressSearch value={form.location_data}
                        onChange={ld => setForm(f => ({ ...f, location_data: { ...f.location_data, ...ld } }))} />
                      {errors.address && <p className="text-red-500 text-xs mt-1">⚠ {errors.address}</p>}
                    </>
                  ) : (
                    <>
                      <input value={form.location_data.rsvp_link}
                        onChange={e => setForm(f => ({ ...f, location_data: { ...f.location_data, rsvp_link: e.target.value } }))}
                        placeholder="https://..."
                        className={`w-full border-3 ${errors.rsvp_link ? 'border-red-500' : 'border-black'} rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none shadow-[3px_3px_0px_black]`} />
                      {errors.rsvp_link && <p className="text-red-500 text-xs mt-1">⚠ {errors.rsvp_link}</p>}
                    </>
                  )}
                </div>

                {/* Photos */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Photos ({photoFiles.length}/5, auto-compressed)</label>
                  <div className="flex flex-wrap gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative w-16 h-16">
                        <img src={p} className="w-full h-full object-cover rounded-xl border-3 border-black" alt="" />
                        <button type="button" onClick={() => { setPhotos(prev => prev.filter((_, j) => j !== i)); setPhotoFiles(prev => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black text-white rounded-full text-xs font-black">✕</button>
                      </div>
                    ))}
                    {photoFiles.length < 5 && (
                      <label className="w-16 h-16 border-3 border-dashed border-black rounded-xl flex items-center justify-center cursor-pointer hover:bg-violet-50 text-2xl">
                        📷<input type="file" accept="image/*" multiple onChange={handlePhotoAdd} className="hidden" />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                {/* Date & Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Date *</label>
                    <input type="date" value={form.event_date} onChange={e => setField('event_date', e.target.value)}
                      className={`w-full border-3 ${errors.event_date ? 'border-red-500' : 'border-black'} rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none shadow-[3px_3px_0px_black]`} />
                    {errors.event_date && <p className="text-red-500 text-xs mt-1">⚠ {errors.event_date}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Start Time *</label>
                    <input type="time" value={form.event_time} onChange={e => setField('event_time', e.target.value)}
                      className={`w-full border-3 ${errors.event_time ? 'border-red-500' : 'border-black'} rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none shadow-[3px_3px_0px_black]`} />
                    {errors.event_time && <p className="text-red-500 text-xs mt-1">⚠ {errors.event_time}</p>}
                  </div>
                </div>

                {/* Timezone + End Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">Timezone</label>
                    <select value={form.timezone.value} onChange={e => setField('timezone', TIMEZONES.find(t => t.value === e.target.value))}
                      className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-bold bg-white shadow-[3px_3px_0px_black] focus:outline-none">
                      {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase mb-1">End Time</label>
                    <input type="time" value={form.event_end_time} onChange={e => setField('event_end_time', e.target.value)}
                      className="w-full border-3 border-black rounded-2xl px-3 py-2.5 text-sm font-medium focus:outline-none shadow-[3px_3px_0px_black]" />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">
                    Description * <span className="text-gray-400 font-normal normal-case">({form.description.length}/320)</span>
                  </label>
                  <textarea value={form.description} onChange={e => setField('description', e.target.value.slice(0, 320))}
                    placeholder="Tell people what this event is about!" rows={4}
                    className={`w-full border-3 ${errors.description ? 'border-red-500' : 'border-black'} rounded-2xl px-3 py-2.5 text-sm font-medium resize-none focus:outline-none focus:bg-violet-50 shadow-[3px_3px_0px_black]`} />
                  {errors.description && <p className="text-red-500 text-xs mt-1">⚠ {errors.description}</p>}
                </div>

                {/* Afters Address (optional) */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">
                    Afters Address <span className="text-gray-400 font-normal normal-case">(optional — where the party continues)</span>
                  </label>
                  <AddressSearch
                    value={{ address: form.afters_address }}
                    onChange={({ address, lat, lng }) => {
                      setField('afters_address', address);
                      setField('afters_lat', lat || null);
                      setField('afters_lng', lng || null);
                    }}
                    placeholder="Search for an after-party spot..."
                  />
                </div>

                {/* Links */}
                <div>
                  <label className="block text-xs font-black uppercase mb-1">Relevant Links</label>
                  {form.relevant_links.map((link, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input value={link} onChange={e => { const ls = [...form.relevant_links]; ls[i] = e.target.value; setField('relevant_links', ls); }}
                        placeholder="https://..."
                        className="flex-1 border-3 border-black rounded-2xl px-3 py-2 text-sm font-medium focus:outline-none shadow-[2px_2px_0px_black]" />
                      {form.relevant_links.length > 1 && (
                        <button type="button" onClick={() => setField('relevant_links', form.relevant_links.filter((_, j) => j !== i))}
                          className="w-9 h-9 bg-red-100 border-3 border-black rounded-xl font-black hover:bg-red-300">✕</button>
                      )}
                    </div>
                  ))}
                  {form.relevant_links.length < 5 && (
                    <button type="button" onClick={() => setField('relevant_links', [...form.relevant_links, ''])}
                      className="text-xs font-black border-2 border-black rounded-xl px-3 py-1 hover:bg-violet-50">+ Add Link</button>
                  )}
                </div>
              </div>
            </div>

            {errors.submit && (
              <div className="mt-4 bg-red-100 border-3 border-red-500 rounded-2xl p-3 text-red-700 font-medium text-sm">
                ⚠ {errors.submit}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="mt-5 w-full text-white font-black text-lg py-4 rounded-2xl transition-colors disabled:opacity-50 shadow-[4px_4px_0px_#333]"
              style={{ backgroundColor: accentColor }}>
              {submitting ? '✨ Submitting...' : '🚀 Submit Event'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}