# Image Modal Component Example

This is a frontend implementation guide for an image modal that opens on image click and closes when clicking outside.

## React/TypeScript Example

```tsx
import React, { useState, useEffect } from 'react';

interface ImageModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ imageUrl, onClose }) => {
  useEffect(() => {
    // Close on Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (imageUrl) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
      onClick={onClose} // Close when clicking outside
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        cursor: 'pointer',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking on image
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          cursor: 'default',
        }}
      >
        <img
          src={imageUrl}
          alt="Full size"
          style={{
            maxWidth: '100%',
            maxHeight: '90vh',
            objectFit: 'contain',
            borderRadius: '8px',
          }}
        />
      </div>
      
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          border: 'none',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          fontSize: '24px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ×
      </button>
    </div>
  );
};

// Usage in Product Card Component
const ProductCard: React.FC<{ product: any }> = ({ product }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const primaryImage = product.images?.find((img: any) => img.is_primary) || product.images?.[0];

  return (
    <>
      <div className="product-card">
        {primaryImage && (
          <img
            src={primaryImage.thumbnail_url || primaryImage.url}
            alt={product.name}
            onClick={() => setSelectedImage(primaryImage.url)}
            style={{ cursor: 'pointer' }}
          />
        )}
        {/* Product details */}
      </div>

      <ImageModal
        imageUrl={selectedImage}
        onClose={() => setSelectedImage(null)}
      />
    </>
  );
};

export default ImageModal;
```

## Tailwind CSS Version

```tsx
import React, { useState, useEffect } from 'react';

interface ImageModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ imageUrl, onClose }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (imageUrl) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt="Full size"
          className="max-w-full max-h-[90vh] object-contain rounded-lg"
        />
      </div>
      
      <button
        onClick={onClose}
        className="absolute top-5 right-5 bg-white bg-opacity-90 rounded-full w-10 h-10 text-2xl flex items-center justify-center hover:bg-opacity-100 transition"
      >
        ×
      </button>
    </div>
  );
};
```

## Backend API Response

The backend already returns full image URLs in the product response:

```json
{
  "success": true,
  "data": {
    "images": [
      {
        "url": "https://res.cloudinary.com/.../full_image.jpg",
        "thumbnail_url": "https://res.cloudinary.com/.../thumbnail.jpg",
        "is_primary": true,
        "public_id": "..."
      }
    ]
  }
}
```

Use `image.url` for the full-size modal image.




