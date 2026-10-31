import { useState, type CSSProperties } from 'react';
import { images, srcFor, srcSetFor, type ImageKey } from '../../lib/images';
import { cn } from '../../lib/cn';

type Props = {
  name: ImageKey;
  sizes?: string;
  className?: string;
  imgClassName?: string;
  imgStyle?: CSSProperties;
  priority?: boolean;
  alt?: string;
  /** Show the "Illustrative" label that marks stock imagery. */
  tag?: boolean | 'light' | 'dark';
  position?: string;
  /** Render the wrapper as a span (for use inside paragraphs). */
  inline?: boolean;
};

/** Responsive, lazy-loaded image with a blurred placeholder that dissolves on load. */
export function Img({ name, sizes = '100vw', className, imgClassName, imgStyle, priority, alt, tag, position = 'center', inline }: Props) {
  const info = images[name];
  const [loaded, setLoaded] = useState(false);
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper
      className={cn('relative block overflow-hidden', className)}
      style={{ backgroundColor: info.color, backgroundImage: `url(${info.lqip})`, backgroundSize: 'cover', backgroundPosition: position }}
    >
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
        }}
        src={srcFor(name, 1280)}
        srcSet={srcSetFor(name)}
        sizes={sizes}
        alt={alt ?? info.alt}
        width={info.width}
        height={info.height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-[opacity,filter] duration-1000 ease-out',
          loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
          imgClassName,
        )}
        style={{ objectPosition: position, ...imgStyle }}
      />
      {tag && <IllustrativeTag tone={tag === 'dark' ? 'dark' : 'light'} />}
    </Wrapper>
  );
}

export function IllustrativeTag({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span
      className={cn(
        'illustrative-tag pointer-events-none absolute bottom-3 left-3 z-10 rounded-full px-2.5 py-1 backdrop-blur-md',
        tone === 'dark' ? 'bg-ink/55 text-ivory/90' : 'bg-ivory/75 text-charcoal/80',
        className,
      )}
    >
      Illustrative photo
    </span>
  );
}
