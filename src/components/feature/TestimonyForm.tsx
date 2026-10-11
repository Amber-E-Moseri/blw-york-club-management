import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../foundation/Modal';
import { Button } from '../foundation/Button';
import { Input } from '../foundation/Input';
import { uploadTestimonyImage } from '../../hooks/useTestimonies';
import type { Testimony, TestimonyInput, TestimonyCategory, TestimonyVisibility, TestimonyEntryType } from '../../types';
import { Banknote, BookOpen, Camera, Eye, Globe, HandHeart, Home, HeartHandshake, Lock, type LucideIcon, PenLine, Sparkles, Sprout, Users, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: TestimonyInput, id?: string) => Promise<void>;
  testimony?: Testimony | null;
  userId?: string;
}

const ENTRY_TYPES: { value: TestimonyEntryType; label: string; icon: LucideIcon; desc: string }[] = [
  { value: 'testimony', label: 'Testimony',  icon: Sparkles, desc: 'Something God has done' },
  { value: 'prophecy',  label: 'Prophecy',   icon: Eye, desc: 'A prophetic word received' },
];

const CATEGORIES: { value: TestimonyCategory; label: string; icon: LucideIcon }[] = [
  { value: 'provision',       label: 'Provision',       icon: Banknote },
  { value: 'healing',         label: 'Healing',         icon: HeartHandshake },
  { value: 'prayer_answered', label: 'Prayer Answered', icon: HandHeart },
  { value: 'growth',          label: 'Spiritual Growth', icon: Sprout },
  { value: 'other',           label: 'Other',           icon: BookOpen },
];

const VISIBILITY: { value: TestimonyVisibility; label: string; desc: string; icon: LucideIcon }[] = [
  { value: 'draft',   label: 'Draft',        icon: PenLine, desc: 'Save for later, not submitted yet' },
  { value: 'private', label: 'Private',      icon: Lock, desc: 'Only visible to you' },
  { value: 'cell',    label: 'My Cell',      icon: Home, desc: 'Cell group members only' },
  { value: 'members', label: 'All Members',  icon: Users, desc: 'All logged-in members (requires approval)' },
  { value: 'public',  label: 'Public',       icon: Globe, desc: 'Posted on public website (requires approval)' },
];

const EMPTY: TestimonyInput = {
  entry_type: 'testimony',
  title: '',
  body: '',
  category: 'other',
  visibility: 'members',
};

export const TestimonyForm: React.FC<Props> = ({ isOpen, onClose, onSave, testimony, userId }) => {
  const [form, setForm]     = useState<TestimonyInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof TestimonyInput, string>>>({});
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile]   = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (testimony) {
      setForm({
        entry_type: testimony.entry_type ?? 'testimony',
        title:      testimony.title,
        body:       testimony.body,
        category:   testimony.category,
        visibility: testimony.visibility,
        image_url:  testimony.image_url,
      });
      setImagePreview(testimony.image_url ?? null);
    } else {
      setForm(EMPTY);
      setImageFile(null);
      setImagePreview(null);
    }
    setErrors({});
  }, [testimony, isOpen]);

  const set = <K extends keyof TestimonyInput>(k: K, v: TestimonyInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, image_url: 'Image must be under 5 MB.' }));
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setErrors((prev) => ({ ...prev, image_url: undefined }));
  };

  const validate = () => {
    const e: Partial<Record<keyof TestimonyInput, string>> = {};
    if (!form.title.trim()) e.title = 'Title is required.';
    if (!form.body.trim() || form.body.trim().length < 20) e.body = 'Please write at least 20 characters.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      let image_url = form.image_url;
      if (imageFile && userId) {
        setUploadingImage(true);
        image_url = await uploadTestimonyImage(imageFile, userId);
        setUploadingImage(false);
      }
      await onSave({ ...form, image_url }, testimony?.id);
      onClose();
    } catch (e) {
      setErrors({ title: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setSaving(false);
      setUploadingImage(false);
    }
  };

  const isVisibilityRequiringApproval = form.visibility === 'members' || form.visibility === 'public';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={testimony ? 'Edit Entry' : 'Share with the Church'}
      subtitle="Give God the glory!"
      size="medium"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {form.visibility === 'draft' ? 'Save Draft' : testimony ? 'Save Changes' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Entry type */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {ENTRY_TYPES.map((et) => (
              <button
                key={et.value}
                type="button"
                onClick={() => set('entry_type', et.value)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all ${
                  form.entry_type === et.value
                    ? 'border-york-600 bg-york-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <et.icon className="w-6 h-6 text-york-600" aria-hidden="true" />
                <span className="text-sm font-semibold text-gray-800">{et.label}</span>
                <span className="text-xs text-gray-400">{et.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Title"
          placeholder={form.entry_type === 'prophecy' ? 'e.g. Word about the harvest season' : 'e.g. God provided for my family'}
          value={form.title}
          onChange={(v) => set('title', v)}
          error={errors.title}
          required
          maxLength={100}
        />

        {/* Category */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">
            Category <span className="text-york-600">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => set('category', cat.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  form.category === cat.value
                    ? 'bg-york-600 text-white border-york-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-york-600 hover:text-york-600'
                }`}
              >
                <cat.icon className="w-4 h-4 inline mr-1.5 -mt-0.5" aria-hidden="true" />{cat.label}
              </button>
            ))}
          </div>
        </div>

        <Input
          label={form.entry_type === 'prophecy' ? 'Prophetic Word' : 'Your Testimony'}
          type="textarea"
          placeholder={form.entry_type === 'prophecy'
            ? 'Share the prophetic word or vision received…'
            : 'Share what God has done for you…'}
          value={form.body}
          onChange={(v) => set('body', v)}
          error={errors.body}
          required
          rows={6}
          maxLength={2000}
        />

        {/* Image upload */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Image (optional)</label>
          {imagePreview ? (
            <div className="relative">
              <img src={imagePreview} alt="Preview" className="w-full max-h-48 object-cover rounded-lg border border-gray-200" />
              <button
                type="button"
                onClick={() => { setImageFile(null); setImagePreview(null); set('image_url', undefined); }}
                className="absolute top-2 right-2 w-7 h-7 bg-york-500 text-white rounded-full flex items-center justify-center hover:bg-york-600 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg py-6 text-center hover:border-york-400 transition-colors"
            >
              <Camera className="w-6 h-6" aria-hidden="true" />
              <p className="text-sm text-gray-500 mt-1">Click to upload an image</p>
              <p className="text-xs text-gray-400">Max 5 MB · JPG, PNG, WebP</p>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
          {errors.image_url && <p className="text-xs text-york-500 mt-1">{errors.image_url}</p>}
          {uploadingImage && <p className="text-xs text-gray-400 mt-1">Uploading image…</p>}
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-sm font-bold text-gray-800 mb-2">Who can see this?</label>
          <div className="space-y-2">
            {VISIBILITY.map((v) => (
              <label key={v.value} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="visibility"
                  value={v.value}
                  checked={form.visibility === v.value}
                  onChange={() => set('visibility', v.value)}
                  className="mt-0.5 text-york-600 focus:ring-york-600"
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800"><v.icon className="w-4 h-4 inline mr-1.5 -mt-0.5 text-york-600" aria-hidden="true" />{v.label}</p>
                  <p className="text-xs text-gray-400">{v.desc}</p>
                </div>
              </label>
            ))}
          </div>
          {isVisibilityRequiringApproval && (
            <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⏳ This will be sent for coordinator review before being published.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
