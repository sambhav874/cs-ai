import localFont from 'next/font/local';

// Define different font variants
export const abcfavoritBold = localFont({
  src: '../public/fonts/ABCFavorit-bold.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-abcfavorit-bold',
});

export const abcfavoritMonoBold = localFont({
  src: '../public/fonts/ABCFavoritMono-Bold.woff2',
  weight: '700',
  style: 'normal',
  variable: '--font-abcfavorit-Mono-bold',
});

export const abcfavoritMonoBoldItalic = localFont({
  src: '../public/fonts/ABCFavoritMono-BoldItalic.woff2',
  weight: '300',
  style: 'normal',
  variable: '--font-abcfavorit-Mono-Bold-Italic',
});

export const abcfavoritMonoBook = localFont({
    src: '../public/fonts/ABCFavoritMono-Book.woff2',
    weight: '300',
    style: 'normal',
    variable: '--font-abcfavorit-Mono-Book',
});

export const abcfavoritMonoBookItalic = localFont({
    src: '../public/fonts/ABCFavoritMono-BookItalic.woff2',
    weight: '300',
    style: 'normal',
    variable: '--font-abcfavorit-Mono-Book-Italic',
  });

export const InterVar = localFont({
  src: '../public/fonts/Inter_Var.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-InterVar',
  display: 'swap',
});

export const AfacadVar = localFont({
  src: '../public/fonts/Afacad_Var.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-AfacadVar',
  display: 'swap',
});

export const GullyVar = localFont({
  src: '../public/fonts/Gully_Var.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-GullyVar',
  display: 'swap',
});

export const IBMVar = localFont({
  src: '../public/fonts/IBM_Var.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-IBMVar',
  display: 'swap',
});