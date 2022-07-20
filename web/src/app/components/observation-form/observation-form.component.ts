/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Component } from '@angular/core';
import { StepType, Step } from '../../shared/models/task/step.model';
import { Cardinality } from '../../shared/models/task/multiple-choice.model';
import { Option } from '../../shared/models/task/option.model';
import { Observation } from '../../shared/models/observation/observation.model';
import { Response } from '../../shared/models/observation/response.model';
import { ObservationService } from '../../services/observation/observation.service';
import {
  FormGroup,
  FormBuilder,
  FormControl,
  Validators,
} from '@angular/forms';
import { List, Map } from 'immutable';
import { DataStoreService } from '../../services/data-store/data-store.service';
import { Survey } from '../../shared/models/survey.model';
import { SurveyService } from '../../services/survey/survey.service';
import { LoadingState } from '../../services/loading-state.model';
import { Observable } from 'rxjs';
import { first } from 'rxjs/operators';
import { Job } from '../../shared/models/job.model';
import { LocationOfInterestService } from '../../services/loi/loi.service';
import { switchMap, map } from 'rxjs/operators';
import { AuthService } from '../../services/auth/auth.service';
import { AuditInfo } from '../../shared/models/audit-info.model';
import { JobListItemActionsType } from '../job-list-item/job-list-item.component';
import { NavigationService } from '../../services/navigation/navigation.service';

// To make ESLint happy:
/*global alert*/

@Component({
  selector: 'ground-observation-form',
  templateUrl: './observation-form.component.html',
  styleUrls: ['./observation-form.component.scss'],
})
export class ObservationFormComponent {
  readonly lang: string;
  readonly stepTypes = StepType;
  readonly cardinality = Cardinality;
  readonly jobListItemActionsType = JobListItemActionsType;
  readonly job$: Observable<Job>;
  surveyId?: string;
  observation?: Observation;
  observationForm?: FormGroup;
  observationSteps?: List<Step>;

  constructor(
    private dataStoreService: DataStoreService,
    private authService: AuthService,
    private formBuilder: FormBuilder,
    private navigationService: NavigationService,
    observationService: ObservationService,
    surveyService: SurveyService,
    loiService: LocationOfInterestService
  ) {
    // TODO: Make dynamic to support i18n.
    this.lang = 'en';
    surveyService.getActiveSurvey$().subscribe((survey?: Survey) => {
      this.surveyId = survey?.id;
    });
    observationService
      .getSelectedObservation$()
      .subscribe((observation?: Observation | LoadingState) =>
        this.onSelectObservation(observation)
      );
    this.job$ = surveyService
      .getActiveSurvey$()
      .pipe(
        switchMap(survey =>
          loiService
            .getSelectedLocationOfInterest$()
            .pipe(map(loi => survey.jobs.get(loi.jobId)!))
        )
      );
  }

  onCancel() {
    this.navigateToLocationOfInterest();
  }

  onSave() {
    this.authService
      .getUser$()
      .pipe(first())
      .subscribe(user => {
        if (!user) {
          throw Error('Login required to update observation.');
        }
        const lastModified = new AuditInfo(
          user,
          /*clientTime=*/ new Date(),
          /*serverTime=*/ this.dataStoreService.getServerTimestamp()
        );
        const updatedResponses: Map<string, Response> = this.extractResponses();
        const updatedObservation = this.observation!.withResponsesAndLastModified(
          updatedResponses,
          lastModified
        );
        this.dataStoreService
          .updateObservation(this.surveyId!, updatedObservation)
          .then(() => {
            this.observationForm?.markAsPristine();
            return this.navigateToLocationOfInterest();
          })
          .catch(() => {
            alert('Observation update failed.');
          });
      });
  }

  private onSelectObservation(observation?: Observation | LoadingState) {
    if (
      observation === LoadingState.NOT_LOADED &&
      this.observationForm?.dirty
    ) {
      if (
        confirm(
          'You have unsaved changes in observation form, do you want to save them?'
        )
      ) {
        this.onSave();
      } else {
        this.observationForm = undefined;
      }
    }
    if (observation instanceof Observation) {
      this.observation = observation;
      this.observationSteps = observation!
        .task!.steps!.toOrderedMap()
        .sortBy(entry => entry.index)
        .toList();
      this.initForm();
    }
  }

  private initForm() {
    if (this.observation === undefined) {
      throw Error('Observation is not selected.');
    }
    this.observationForm = this.convertObservationToFormGroup(
      this.observation!
    );
  }

  private navigateToLocationOfInterest() {
    this.navigationService.clearObservationId();
  }

  private convertObservationToFormGroup(observation: Observation): FormGroup {
    const group: { [stepId: string]: FormControl } = {};
    for (const [stepId, step] of observation.task!.steps) {
      const response = observation!.responses?.get(stepId);
      switch (step.type) {
        case StepType.TEXT:
          this.addControlsForTextStep(group, step, response);
          break;
        case StepType.NUMBER:
          this.addControlsForNumberStep(group, step, response);
          break;
        case StepType.MULTIPLE_CHOICE:
          this.addControlsForMultipleChoiceStep(group, step, response);
          break;
        default:
          console.debug(`Skipping unsupported step type: ${step.type}`);
      }
    }
    return this.formBuilder.group(group);
  }

  private extractResponses(): Map<string, Response> {
    return Map<string, Response>(
      this.observationSteps!.map(step => [
        step.id,
        this.extractResponseForStep(step),
      ])
    );
  }

  private extractResponseForStep(step: Step) {
    switch (step.type) {
      case StepType.TEXT:
        return this.extractResponseForTextStep(step);
      case StepType.NUMBER:
        return this.extractResponseForNumberStep(step);
      case StepType.MULTIPLE_CHOICE:
        return this.extractResponseForMultipleChoiceStep(step);
      default:
        throw Error(
          `Unimplemented Response extraction for Step with
           Type:${step.type}`
        );
    }
  }

  private addControlsForTextStep(
    group: { [stepId: string]: FormControl },
    step: Step,
    response?: Response
  ): void {
    const value = response?.value as string;
    group[step.id] = step.required
      ? new FormControl(value, Validators.required)
      : new FormControl(value);
  }

  private addControlsForNumberStep(
    group: { [stepId: string]: FormControl },
    step: Step,
    response?: Response
  ): void {
    const value = response?.value as number;
    group[step.id] = step.required
      ? new FormControl(value, Validators.required)
      : new FormControl(value);
  }

  private extractResponseForTextStep(step: Step): Response {
    return new Response(this.observationForm?.value[step.id]);
  }

  private extractResponseForNumberStep(step: Step): Response {
    return new Response(this.observationForm?.value[step.id]);
  }

  private addControlsForMultipleChoiceStep(
    group: { [stepId: string]: FormControl },
    step: Step,
    response?: Response
  ): void {
    switch (step.multipleChoice?.cardinality) {
      case Cardinality.SELECT_ONE:
        this.addControlsForSelectOneStep(group, step, response);
        return;
      case Cardinality.SELECT_MULTIPLE:
        this.addControlsForSelectMultipleStep(group, step, response);
        return;
      default:
        throw Error(
          `Unimplemented conversion to FormControl(s) for Step with
           Cardinality:${step.multipleChoice?.cardinality}`
        );
    }
  }

  private extractResponseForMultipleChoiceStep(step: Step): Response {
    switch (step.multipleChoice?.cardinality) {
      case Cardinality.SELECT_ONE:
        return this.extractResponseForSelectOneStep(step);
      case Cardinality.SELECT_MULTIPLE:
        return this.extractResponseForSelectMultipleStep(step);
      default:
        throw Error(
          `Unimplemented Response extraction for Step with
           Cardinality:${step.multipleChoice?.cardinality}`
        );
    }
  }

  private addControlsForSelectOneStep(
    group: { [stepId: string]: FormControl },
    step: Step,
    response?: Response
  ): void {
    const selectedOptionId = ((response?.value as List<Option>)?.first() as Option)
      ?.id;
    group[step.id] = step.required
      ? new FormControl(selectedOptionId, Validators.required)
      : new FormControl(selectedOptionId);
  }

  private extractResponseForSelectOneStep(step: Step): Response {
    const selectedOption: Option = step.getMultipleChoiceOption(
      this.observationForm?.value[step.id]
    );
    return new Response(List([selectedOption]));
  }

  private addControlsForSelectMultipleStep(
    group: { [stepId: string]: FormControl },
    step: Step,
    response?: Response
  ): void {
    const selectedOptions = response?.value as List<Option>;
    for (const option of step.multipleChoice!.options) {
      group[option.id] = new FormControl(selectedOptions?.contains(option));
    }
  }

  private extractResponseForSelectMultipleStep(step: Step): Response {
    const selectedOptions: List<Option> = step.multipleChoice!.options!.filter(
      option => this.observationForm?.value[option.id]
    );
    return new Response(selectedOptions);
  }
}
