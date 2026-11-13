import { RELATIONSHIP_CLASSES } from "../core/constants.js";

export function relationshipClassOf(relationship = {}) {
  return Object.values(RELATIONSHIP_CLASSES).includes(relationship?.relationshipClass)
    ? relationship.relationshipClass
    : RELATIONSHIP_CLASSES.PHYSICAL;
}

export function isPhysicalRelationship(relationship = {}) {
  return relationshipClassOf(relationship) === RELATIONSHIP_CLASSES.PHYSICAL;
}

export function isObservationalRelationship(relationship = {}) {
  return relationshipClassOf(relationship) === RELATIONSHIP_CLASSES.OBSERVATIONAL;
}

export function withRelationshipClassDefault(relationship = {}) {
  return {
    ...relationship,
    relationshipClass: relationshipClassOf(relationship)
  };
}
