/**
 * Which seeded person the demo console is signed in as.
 *
 * The product is two different jobs behind one URL. An Agent sees the
 * customers they hold and the calls the AI hands them; a Manager sees the
 * whole brand, who is carrying what, and how well. Describing that difference
 * is easy and unconvincing — being able to swap between the two screens in a
 * click is how anyone actually checks it is real.
 *
 * So the switcher exists, and it is strictly a demo-mode affordance. With
 * Clerk on, identity comes from the signed-in user and this cookie is not
 * consulted at all: nothing here can be used to become someone else in a real
 * workspace. The role model does not change either way — swapping profile
 * changes *who is asking*, and every capability check, brand scope and audit
 * row behaves exactly as it does for a real session.
 */
export const PROFILE_COOKIE = "corva_profile";
