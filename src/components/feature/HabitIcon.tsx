import React from 'react';
import {
  BookOpen, Check, Droplets, Dumbbell, Flower, Footprints, HandHeart, Heart,
  Music, PenLine, Salad, Smartphone, Sunrise, type LucideIcon,
} from 'lucide-react';

/** Icon keys stored on habit templates. Older rows may still hold a raw emoji. */
const HABIT_ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  hands: HandHeart,
  pen: PenLine,
  run: Footprints,
  strength: Dumbbell,
  stillness: Flower,
  sunrise: Sunrise,
  water: Droplets,
  nutrition: Salad,
  digital: Smartphone,
  music: Music,
  heart: Heart,
  check: Check,
};

/** Keys offered in the habit icon picker (the default `check` is set directly). */
export const HABIT_ICON_KEYS = Object.keys(HABIT_ICONS).filter((k) => k !== 'check');

interface HabitIconProps {
  value: string;
  className?: string;
}

export const HabitIcon: React.FC<HabitIconProps> = ({ value, className }) => {
  const Icon = HABIT_ICONS[value];
  if (!Icon) return <span className={className}>{value}</span>;
  return <Icon className={className} aria-hidden="true" />;
};
